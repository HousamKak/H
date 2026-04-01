import type { AgentInstance, AgentDefinition, Task, ToolCall } from '@h/types';
import { generateId } from '@h/types';
import type { EventBus } from '@h/events';
import type { LLMProvider, LLMMessage } from '@h/llm';
import type { ToolExecutor } from '@h/tools';
import type { MemoryService } from '@h/memory';
import { WorkingMemory } from '@h/memory';
import type { TaskService } from '@h/tasks';
import type { AgentRepository } from '@h/db';

interface RuntimeDeps {
  eventBus: EventBus;
  llmProvider: LLMProvider;
  toolExecutor: ToolExecutor;
  memoryService: MemoryService;
  taskService: TaskService;
  agentRepo: AgentRepository;
}

export class AgentRuntime {
  private instance: AgentInstance;
  private definition: AgentDefinition;
  private deps: RuntimeDeps;
  private workingMemory: WorkingMemory;
  private conversationHistory: LLMMessage[] = [];
  private running = false;
  private abortController: AbortController | null = null;

  constructor(instance: AgentInstance, definition: AgentDefinition, deps: RuntimeDeps) {
    this.instance = instance;
    this.definition = definition;
    this.deps = deps;
    this.workingMemory = new WorkingMemory(definition.tokenBudget);
  }

  get id(): string { return this.instance.id; }
  get status(): string { return this.instance.status; }
  get isRunning(): boolean { return this.running; }

  async start(task: Task): Promise<void> {
    this.running = true;
    this.abortController = new AbortController();

    // Transition: spawning/idle → working
    this.instance.status = 'working';
    this.instance.currentTaskId = task.id;
    this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'working', {
      currentTaskId: task.id,
    });

    await this.deps.eventBus.emit('agent.started', {
      agentId: this.instance.id,
      previousStatus: 'idle',
    }, {
      source: `agent:${this.instance.id}`,
      projectId: this.instance.projectId,
      agentId: this.instance.id,
      taskId: task.id,
    });

    await this.deps.taskService.start(task.id, this.instance.id);

    try {
      await this.thinkActLoop(task);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await this.handleError(error, task);
    } finally {
      this.running = false;
      this.abortController = null;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abortController?.abort();

    this.instance.status = 'terminated';
    this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'terminated');

    await this.deps.eventBus.emit('agent.terminated', {
      agentId: this.instance.id,
      previousStatus: 'working',
      reason: 'Manual stop',
    }, {
      source: `agent:${this.instance.id}`,
      projectId: this.instance.projectId,
      agentId: this.instance.id,
    });
  }

  private async thinkActLoop(task: Task): Promise<void> {
    // Build initial context
    const projectMemory = await this.deps.memoryService.recall({
      projectId: this.instance.projectId,
      limit: 10,
      minImportance: 0.3,
    });

    const memoryContext = projectMemory.length > 0
      ? '\n\n## Relevant Memory\n' + projectMemory.map((m) => `- [${m.type}] ${m.content}`).join('\n')
      : '';

    // Available tools description
    const toolDefs = this.deps.toolExecutor.getDefinitions()
      .filter((t) => this.definition.capabilities.includes(t.name));

    const toolsDescription = toolDefs.map((t) =>
      `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.inputSchema)}`
    ).join('\n');

    const jsonInstructions = `You MUST respond with ONLY valid JSON, no other text. Use one of these two formats:

To use tools:
{"thought": "your reasoning", "tool_calls": [{"name": "tool_name", "arguments": {"arg": "value"}}]}

When the task is complete:
{"thought": "summary of what was done", "done": true, "result": {"summary": "what was accomplished"}}`;

    this.conversationHistory = [
      { role: 'system', content: this.definition.systemPrompt + memoryContext + '\n\nCRITICAL: ' + jsonInstructions },
      {
        role: 'user',
        content: `## Task\n**${task.title}**\n\n${task.description}\n\n## Available Tools\n${toolsDescription}\n\nRespond with JSON only.`
      },
    ];

    let turnCount = 0;
    const maxTurns = this.definition.maxTurns;

    while (this.running && turnCount < maxTurns) {
      if (this.abortController?.signal.aborted) break;

      turnCount++;
      this.instance.turnCount = turnCount;
      this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'working', {
        turnCount,
      });

      // THINK: Call LLM
      console.log(`[Agent:${this.instance.definitionRole}] Turn ${turnCount} - calling LLM...`);
      const response = await this.deps.llmProvider.generate({
        messages: this.conversationHistory,
        temperature: this.definition.temperature,
        maxTokens: 4096,
      });

      const content = response.content;
      console.log(`[Agent:${this.instance.definitionRole}] Turn ${turnCount} - response (${content.length} chars): ${content.substring(0, 200)}`);
      this.conversationHistory.push({ role: 'assistant', content });

      // Parse response - try to extract JSON from the response
      let parsed: any;
      try {
        const jsonStr = content.match(/\{[\s\S]*\}/)?.[0];
        parsed = jsonStr ? JSON.parse(jsonStr) : null;
      } catch {
        parsed = null;
      }

      // If we couldn't parse JSON, remind the LLM and continue
      if (!parsed) {
        this.conversationHistory.push({
          role: 'user',
          content: 'Your response was not valid JSON. You MUST respond with ONLY a JSON object. Example: {"thought": "my reasoning", "done": true, "result": {"summary": "what I did"}}',
        });
        continue;
      }

      // Normalize tool call format: {"tool": "x", "parameters": {...}} → tool_calls array
      if (parsed.tool && !parsed.tool_calls) {
        parsed.tool_calls = [{
          name: parsed.tool,
          arguments: parsed.parameters ?? parsed.arguments ?? parsed.args ?? {},
        }];
        if (!parsed.thought) parsed.thought = `Using tool: ${parsed.tool}`;
      }

      // Normalize response: accept various completion indicators
      const isDone = parsed.done === true
        || parsed.status === 'success'
        || parsed.status === 'complete'
        || parsed.status === 'completed'
        || (parsed.result && !parsed.tool_calls);
      if (isDone && !parsed.done) {
        parsed.done = true;
        if (!parsed.thought) parsed.thought = parsed.summary ?? parsed.message ?? 'Task completed';
      }

      // Report progress
      if (parsed.thought) {
        await this.deps.taskService.progress(task.id, parsed.thought);
        await this.deps.eventBus.emit('agent.progress', {
          agentId: this.instance.id,
          summary: parsed.thought,
          turnCount,
        }, {
          source: `agent:${this.instance.id}`,
          projectId: this.instance.projectId,
          agentId: this.instance.id,
          taskId: task.id,
        });
      }

      // Check if done
      if (parsed.done) {
        await this.deps.taskService.complete(task.id, {
          success: true,
          summary: parsed.result?.summary ?? parsed.thought ?? 'Task completed',
          filesChanged: parsed.result?.filesChanged ?? [],
          linesAdded: parsed.result?.linesAdded ?? 0,
          linesRemoved: parsed.result?.linesRemoved ?? 0,
        });

        // Transition to idle
        this.instance.status = 'idle';
        this.instance.currentTaskId = undefined;
        this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'idle', {
          currentTaskId: null,
          turnCount,
        });

        await this.deps.eventBus.emit('agent.idle', {
          agentId: this.instance.id,
          previousStatus: 'working',
        }, {
          source: `agent:${this.instance.id}`,
          projectId: this.instance.projectId,
          agentId: this.instance.id,
        });

        return;
      }

      // ACT: Execute tool calls
      if (parsed.tool_calls?.length) {
        const toolResults: string[] = [];

        for (const call of parsed.tool_calls) {
          const result = await this.deps.toolExecutor.execute({
            toolName: call.name,
            arguments: call.arguments ?? {},
            agentId: this.instance.id,
            taskId: task.id,
            projectId: this.instance.projectId,
            workingDirectory: await this.getProjectPath(),
          });

          const resultStr = result.success
            ? `[${call.name}] Success: ${typeof result.output === 'string' ? result.output : JSON.stringify(result.output)}`
            : `[${call.name}] Error: ${result.error}`;

          toolResults.push(resultStr);
        }

        this.conversationHistory.push({
          role: 'user',
          content: `## Tool Results\n${toolResults.join('\n\n')}`,
        });
      } else if (!parsed.done) {
        // No tool calls and not done - nudge toward action or completion
        this.conversationHistory.push({
          role: 'user',
          content: 'You must either use a tool ({"thought": "...", "tool_calls": [...]}) or mark the task as done ({"thought": "...", "done": true, "result": {"summary": "..."}}).',
        });
      }

      // Compact conversation if it's getting long
      if (this.conversationHistory.length > 20) {
        this.compactHistory();
      }
    }

    // Ran out of turns
    if (turnCount >= maxTurns) {
      await this.deps.taskService.fail(task.id, `Agent reached maximum turn limit (${maxTurns})`);
      this.instance.status = 'idle';
      this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'idle', { currentTaskId: null });
    }
  }

  private async handleError(error: string, task: Task): Promise<void> {
    this.instance.status = 'error';
    this.instance.errorMessage = error;
    this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'error', { errorMessage: error });

    await this.deps.taskService.fail(task.id, error);

    await this.deps.eventBus.emit('agent.error', {
      agentId: this.instance.id,
      error,
    }, {
      source: `agent:${this.instance.id}`,
      projectId: this.instance.projectId,
      agentId: this.instance.id,
      taskId: task.id,
    });
  }

  private compactHistory(): void {
    // Keep system message and last 10 messages
    const system = this.conversationHistory[0];
    const recent = this.conversationHistory.slice(-10);
    this.conversationHistory = [system, ...recent];
  }

  private async getProjectPath(): Promise<string> {
    const { ProjectRepository } = await import('@h/db');
    const repo = new ProjectRepository();
    const project = repo.findById(this.instance.projectId);
    return project?.path ?? process.cwd();
  }
}

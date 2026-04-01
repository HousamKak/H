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

    this.conversationHistory = [
      { role: 'system', content: this.definition.systemPrompt + memoryContext },
      {
        role: 'user',
        content: `## Task\n**${task.title}**\n\n${task.description}\n\n## Available Tools\n${toolsDescription}\n\n## Instructions\nWork on this task. Use tools by responding with JSON:\n{"thought": "your reasoning", "tool_calls": [{"name": "tool_name", "arguments": {...}}]}\n\nWhen the task is complete, respond with:\n{"thought": "summary", "done": true, "result": {"summary": "what was done", "filesChanged": [...]}}`
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
      const response = await this.deps.llmProvider.generate({
        messages: this.conversationHistory,
        temperature: this.definition.temperature,
        maxTokens: 4096,
      });

      const content = response.content;
      this.conversationHistory.push({ role: 'assistant', content });

      // Parse response
      let parsed: any;
      try {
        const jsonStr = content.match(/\{[\s\S]*\}/)?.[0];
        parsed = jsonStr ? JSON.parse(jsonStr) : { thought: content, done: false };
      } catch {
        parsed = { thought: content, done: false };
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

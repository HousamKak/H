import type {
  AgentInstance, AgentDefinition, Task, ContextAnchor,
  AgentCheckpoint, ClassifiedError,
} from '@h/types';
import { generateId } from '@h/types';
import type { EventBus } from '@h/events';
import type { LLMProvider, LLMMessage, GenerateResult } from '@h/llm';
import { classifyError, retryWithBackoff } from '@h/llm';
import type { ToolExecutor } from '@h/tools';
import type { MemoryService, BlackboardService } from '@h/memory';
import { WorkingMemory } from '@h/memory';
import type { TaskService } from '@h/tasks';
import { AgentRepository, CheckpointRepository, CostRepository, TraceRepository } from '@h/db';

export interface RuntimeDeps {
  eventBus: EventBus;
  llmProvider: LLMProvider;
  toolExecutor: ToolExecutor;
  memoryService: MemoryService;
  blackboard: BlackboardService;
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

  // New state for enhanced runtime
  private contextAnchor: ContextAnchor = {
    intent: '', changesMade: [], decisionsTaken: [], nextSteps: [], tokenCount: 0,
  };
  private totalTokens = { input: 0, output: 0, total: 0 };
  private checkpointRepo = new CheckpointRepository();
  private costRepo = new CostRepository();
  private traceRepo = new TraceRepository();
  private taskStartTime = 0;

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
    this.taskStartTime = Date.now();
    this.totalTokens = { input: 0, output: 0, total: 0 };

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
      const classified = classifyError(err);
      await this.handleClassifiedError(classified, task);
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

  // =========================================================================
  // MAIN THINK-ACT LOOP (enhanced with reflection, blackboard, checkpoints)
  // =========================================================================

  private async thinkActLoop(task: Task): Promise<void> {
    // ---- Build initial context ----
    const projectMemory = await this.deps.memoryService.recall({
      projectId: this.instance.projectId,
      limit: 10,
      minImportance: 0.3,
    });

    const memoryContext = projectMemory.length > 0
      ? '\n\n## Relevant Memory\n' + projectMemory.map(m => `- [${m.type}] ${m.content}`).join('\n')
      : '';

    // Blackboard context from other agents
    const blackboardContext = this.deps.blackboard.buildContext(
      this.instance.projectId, task.id,
    );

    const toolDefs = this.deps.toolExecutor.getDefinitions()
      .filter(t => this.definition.capabilities.includes(t.name));

    const toolsDescription = toolDefs.map(t =>
      `- ${t.name}: ${t.description}\n  Parameters: ${JSON.stringify(t.inputSchema)}`
    ).join('\n');

    const jsonInstructions = `You MUST respond with ONLY valid JSON, no other text. Use one of these formats:

To use tools:
{"thought": "your reasoning", "tool_calls": [{"name": "tool_name", "arguments": {"arg": "value"}}]}

When the task is complete:
{"thought": "summary of what was done", "done": true, "result": {"summary": "what was accomplished", "filesChanged": [], "lessonsLearned": []}}`;

    this.contextAnchor.intent = `${task.title}: ${task.description}`;

    this.conversationHistory = [
      {
        role: 'system',
        content: this.definition.systemPrompt + memoryContext
          + (blackboardContext ? '\n\n' + blackboardContext : '')
          + '\n\nCRITICAL: ' + jsonInstructions,
      },
      {
        role: 'user',
        content: `## Task\n**${task.title}**\n\n${task.description}\n\n## Available Tools\n${toolsDescription}\n\nRespond with JSON only.`,
      },
    ];

    let turnCount = 0;
    const maxTurns = this.definition.maxTurns;
    let retryCount = 0;
    const maxRetries = 3;

    while (this.running && turnCount < maxTurns) {
      if (this.abortController?.signal.aborted) break;

      turnCount++;
      this.instance.turnCount = turnCount;
      this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'working', { turnCount });

      // ---- THINK: Call LLM with retry ----
      let response: GenerateResult;
      try {
        response = await retryWithBackoff(
          () => this.deps.llmProvider.generate({
            messages: this.conversationHistory,
            temperature: this.definition.temperature,
            maxTokens: 4096,
          }),
          { maxRetries: 2 },
        );
        retryCount = 0; // reset on success
      } catch (err) {
        const classified = classifyError(err);
        if (classified.retryable && retryCount < maxRetries) {
          retryCount++;
          turnCount--; // don't count failed turns
          continue;
        }
        throw err;
      }

      // Track tokens and cost
      this.totalTokens.input += response.usage.inputTokens;
      this.totalTokens.output += response.usage.outputTokens;
      this.totalTokens.total += response.usage.totalTokens;
      this.recordCost(response, task);

      const content = response.content;
      this.conversationHistory.push({ role: 'assistant', content });

      // ---- PARSE response ----
      let parsed: any;
      try {
        const jsonStr = content.match(/\{[\s\S]*\}/)?.[0];
        parsed = jsonStr ? JSON.parse(jsonStr) : null;
      } catch { parsed = null; }

      if (!parsed) {
        this.conversationHistory.push({
          role: 'user',
          content: 'Your response was not valid JSON. You MUST respond with ONLY a JSON object. Example: {"thought": "my reasoning", "done": true, "result": {"summary": "what I did"}}',
        });
        continue;
      }

      // ---- NORMALIZE ----
      if (parsed.tool && !parsed.tool_calls) {
        parsed.tool_calls = [{
          name: parsed.tool,
          arguments: parsed.parameters ?? parsed.arguments ?? parsed.args ?? {},
        }];
        if (!parsed.thought) parsed.thought = `Using tool: ${parsed.tool}`;
      }

      const isDone = parsed.done === true
        || parsed.status === 'success'
        || parsed.status === 'complete'
        || parsed.status === 'completed'
        || (parsed.result && !parsed.tool_calls);
      if (isDone && !parsed.done) {
        parsed.done = true;
        if (!parsed.thought) parsed.thought = parsed.summary ?? parsed.message ?? 'Task completed';
      }

      // ---- PROGRESS ----
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

      // ---- COMPLETION ----
      if (parsed.done) {
        // Optional reflection before finalizing
        if (this.definition.enableReflection) {
          const reflectionResult = await this.reflect(task, parsed);
          if (reflectionResult === 'continue') {
            parsed.done = false; // reflection says we're not done
          }
        }

        if (parsed.done) {
          // Post findings to blackboard
          if (parsed.result?.summary) {
            this.deps.blackboard.post({
              projectId: this.instance.projectId,
              agentId: this.instance.id,
              taskId: task.id,
              type: 'decision',
              content: parsed.result.summary,
              confidence: 0.8,
            });
          }

          // Store lessons as episodic memory
          if (parsed.result?.lessonsLearned?.length) {
            for (const lesson of parsed.result.lessonsLearned) {
              await this.deps.memoryService.store({
                projectId: this.instance.projectId,
                agentId: this.instance.id,
                type: 'error_lesson',
                content: lesson,
                tags: ['lesson', this.definition.role],
                importance: 0.7,
              });
            }
          }

          await this.deps.taskService.complete(task.id, {
            success: true,
            summary: parsed.result?.summary ?? parsed.thought ?? 'Task completed',
            filesChanged: parsed.result?.filesChanged ?? [],
            linesAdded: parsed.result?.linesAdded ?? 0,
            linesRemoved: parsed.result?.linesRemoved ?? 0,
          });

          this.transitionToIdle(turnCount);
          return;
        }
      }

      // ---- ACT: Execute tool calls ----
      if (parsed.tool_calls?.length) {
        const toolResults: string[] = [];

        for (const call of parsed.tool_calls) {
          const spanId = this.traceRepo.startSpan({
            traceId: task.id,
            agentId: this.instance.id,
            taskId: task.id,
            operation: 'tool_exec',
            toolName: call.name,
          }).id;

          const result = await this.deps.toolExecutor.execute({
            toolName: call.name,
            arguments: call.arguments ?? {},
            agentId: this.instance.id,
            taskId: task.id,
            projectId: this.instance.projectId,
            workingDirectory: await this.getProjectPath(),
          });

          this.traceRepo.endSpan(spanId, {
            status: result.success ? 'ok' : 'error',
            errorMessage: result.error,
          });

          // Track changes for context anchor
          if (call.name === 'file_write' && call.arguments?.path) {
            this.contextAnchor.changesMade.push(`Modified: ${call.arguments.path}`);
          }

          const resultStr = result.success
            ? `[${call.name}] Success: ${typeof result.output === 'string' ? result.output : JSON.stringify(result.output)}`
            : `[${call.name}] Error: ${result.error}`;

          toolResults.push(resultStr);
        }

        this.conversationHistory.push({
          role: 'user',
          content: `## Tool Results\n${toolResults.join('\n\n')}`,
        });

        // Post discoveries to blackboard
        if (parsed.thought && parsed.thought.length > 20) {
          this.deps.blackboard.post({
            projectId: this.instance.projectId,
            agentId: this.instance.id,
            taskId: task.id,
            type: 'discovery',
            content: parsed.thought,
            confidence: 0.6,
          });
        }
      } else if (!parsed.done) {
        this.conversationHistory.push({
          role: 'user',
          content: 'You must either use a tool ({"thought": "...", "tool_calls": [...]}) or mark the task as done ({"thought": "...", "done": true, "result": {"summary": "..."}}).',
        });
      }

      // ---- CHECKPOINT after tool execution ----
      if (turnCount % 5 === 0 || parsed.tool_calls?.length) {
        this.saveCheckpoint(task, turnCount);
      }

      // ---- PERIODIC REFLECTION ----
      const reflectionInterval = this.definition.reflectionInterval ?? 10;
      if (this.definition.enableReflection && turnCount > 0 && turnCount % reflectionInterval === 0) {
        await this.reflect(task);
      }

      // ---- CONTEXT COMPACTION (anchored summarization) ----
      if (this.conversationHistory.length > 20) {
        await this.compactHistory(task);
      }
    }

    // Ran out of turns
    if (turnCount >= maxTurns) {
      await this.deps.taskService.fail(task.id, `Agent reached maximum turn limit (${maxTurns})`);
      this.transitionToIdle(turnCount);
    }
  }

  // =========================================================================
  // REFLECTION: Agent evaluates its own work
  // =========================================================================

  private async reflect(task: Task, lastParsed?: any): Promise<'continue' | 'done'> {
    await this.deps.eventBus.emit('agent.reflecting', {
      agentId: this.instance.id,
      turnCount: this.instance.turnCount,
    }, {
      source: `agent:${this.instance.id}`,
      projectId: this.instance.projectId,
      agentId: this.instance.id,
      taskId: task.id,
    });

    const changesStr = this.contextAnchor.changesMade.length > 0
      ? `Files changed: ${this.contextAnchor.changesMade.join(', ')}`
      : 'No files changed yet';

    const reflectionPrompt = `## Self-Reflection Check
You are reflecting on your progress. Answer in JSON only.

Task: ${task.title}
${changesStr}
${lastParsed?.result?.summary ? `Your proposed result: ${lastParsed.result.summary}` : ''}

Consider:
1. Did you satisfy all requirements of the task?
2. Are there edge cases or issues you missed?
3. Is the work complete and correct?

Respond: {"reflection": "your analysis", "satisfied": true/false, "issues": ["any issues found"]}`;

    this.conversationHistory.push({ role: 'user', content: reflectionPrompt });

    try {
      const response = await this.deps.llmProvider.generate({
        messages: this.conversationHistory,
        temperature: 0.3, // lower temp for reflection
        maxTokens: 2048,
      });

      this.totalTokens.input += response.usage.inputTokens;
      this.totalTokens.output += response.usage.outputTokens;
      this.totalTokens.total += response.usage.totalTokens;

      this.conversationHistory.push({ role: 'assistant', content: response.content });

      const jsonStr = response.content.match(/\{[\s\S]*\}/)?.[0];
      const parsed = jsonStr ? JSON.parse(jsonStr) : null;

      if (parsed?.satisfied === false && parsed.issues?.length > 0) {
        // Post issues to blackboard
        for (const issue of parsed.issues) {
          this.deps.blackboard.post({
            projectId: this.instance.projectId,
            agentId: this.instance.id,
            taskId: task.id,
            type: 'blocker',
            content: issue,
            confidence: 0.7,
          });
        }

        this.conversationHistory.push({
          role: 'user',
          content: `Reflection found issues: ${parsed.issues.join('; ')}. Please address them before completing.`,
        });
        return 'continue';
      }

      if (parsed?.reflection) {
        this.contextAnchor.decisionsTaken.push(`Reflection: ${parsed.reflection}`);
      }
    } catch {
      // Reflection failure is non-fatal
    }

    return 'done';
  }

  // =========================================================================
  // ANCHORED ITERATIVE SUMMARIZATION (replaces naive compactHistory)
  // =========================================================================

  private async compactHistory(task: Task): Promise<void> {
    const system = this.conversationHistory[0];
    const recentCount = 7;
    const recent = this.conversationHistory.slice(-recentCount);
    const toSummarize = this.conversationHistory.slice(1, -recentCount);

    if (toSummarize.length < 5) return; // not enough to compact

    // Build summary of evicted messages
    const evictedText = toSummarize.map(m => `[${m.role}]: ${m.content.substring(0, 300)}`).join('\n');

    try {
      const summaryResponse = await this.deps.llmProvider.generate({
        messages: [
          {
            role: 'system',
            content: 'Summarize the following conversation segment into a concise context anchor. Extract: intent (what the agent is doing), changes_made (files/code modified), decisions_taken (choices made), next_steps (what still needs to happen). Respond in JSON only.',
          },
          {
            role: 'user',
            content: `Current task: ${task.title}\n\nConversation to summarize:\n${evictedText}\n\nRespond: {"intent": "...", "changes_made": [...], "decisions_taken": [...], "next_steps": [...]}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 1024,
      });

      this.totalTokens.input += summaryResponse.usage.inputTokens;
      this.totalTokens.output += summaryResponse.usage.outputTokens;
      this.totalTokens.total += summaryResponse.usage.totalTokens;

      const jsonStr = summaryResponse.content.match(/\{[\s\S]*\}/)?.[0];
      const summary = jsonStr ? JSON.parse(jsonStr) : null;

      if (summary) {
        // Merge into existing anchor
        if (summary.intent) this.contextAnchor.intent = summary.intent;
        if (summary.changes_made) this.contextAnchor.changesMade.push(...summary.changes_made);
        if (summary.decisions_taken) this.contextAnchor.decisionsTaken.push(...summary.decisions_taken);
        if (summary.next_steps) this.contextAnchor.nextSteps = summary.next_steps;

        // Deduplicate
        this.contextAnchor.changesMade = [...new Set(this.contextAnchor.changesMade)];
        this.contextAnchor.decisionsTaken = [...new Set(this.contextAnchor.decisionsTaken)];
      }
    } catch {
      // Summarization failure: fall back to naive truncation
    }

    // Build context anchor message
    const anchorMsg = `## Context Summary (prior conversation compressed)
**Intent:** ${this.contextAnchor.intent}
**Changes Made:** ${this.contextAnchor.changesMade.join(', ') || 'none yet'}
**Decisions:** ${this.contextAnchor.decisionsTaken.join('; ') || 'none yet'}
**Next Steps:** ${this.contextAnchor.nextSteps.join('; ') || 'continue working'}`;

    this.conversationHistory = [
      system,
      { role: 'user', content: anchorMsg },
      ...recent,
    ];

    this.contextAnchor.tokenCount = this.estimateTokens(this.conversationHistory);

    await this.deps.eventBus.emit('agent.context.compacted', {
      agentId: this.instance.id,
      previousLength: toSummarize.length + recentCount + 1,
      newLength: this.conversationHistory.length,
      anchorTokens: this.contextAnchor.tokenCount,
    }, {
      source: `agent:${this.instance.id}`,
      projectId: this.instance.projectId,
      agentId: this.instance.id,
      taskId: task.id,
    });
  }

  // =========================================================================
  // CHECKPOINTING
  // =========================================================================

  private saveCheckpoint(task: Task, turnCount: number): void {
    try {
      const checkpoint: Omit<AgentCheckpoint, 'id'> = {
        agentId: this.instance.id,
        taskId: task.id,
        timestamp: new Date().toISOString(),
        turnCount,
        contextAnchor: this.contextAnchor,
        recentMessages: this.conversationHistory.slice(-7).map(m => ({
          role: m.role,
          content: m.content.substring(0, 2000), // truncate for storage
        })),
        tokenUsage: { ...this.totalTokens },
      };

      this.checkpointRepo.save(checkpoint);

      this.deps.eventBus.emit('agent.checkpoint', {
        agentId: this.instance.id,
        turnCount,
        tokenUsage: this.totalTokens,
      }, {
        source: `agent:${this.instance.id}`,
        projectId: this.instance.projectId,
        agentId: this.instance.id,
        taskId: task.id,
      });
    } catch {
      // Checkpoint failure is non-fatal
    }
  }

  // =========================================================================
  // ERROR HANDLING (classified)
  // =========================================================================

  private async handleClassifiedError(classified: ClassifiedError, task: Task): Promise<void> {
    const errorDetail = `[${classified.category}] ${classified.message}`;

    // Store error lesson for episodic memory
    await this.deps.memoryService.store({
      projectId: this.instance.projectId,
      agentId: this.instance.id,
      type: 'error_lesson',
      content: `Task "${task.title}" failed with ${classified.category} error: ${classified.message}`,
      tags: ['error', classified.category, this.definition.role],
      importance: 0.8,
    });

    // Post to blackboard
    this.deps.blackboard.post({
      projectId: this.instance.projectId,
      agentId: this.instance.id,
      taskId: task.id,
      type: 'blocker',
      content: errorDetail,
      confidence: 0.9,
    });

    this.instance.status = 'error';
    this.instance.errorMessage = errorDetail;
    this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'error', { errorMessage: errorDetail });

    await this.deps.taskService.fail(task.id, errorDetail);

    await this.deps.eventBus.emit('agent.error', {
      agentId: this.instance.id,
      error: errorDetail,
      category: classified.category,
      retryable: classified.retryable,
    }, {
      source: `agent:${this.instance.id}`,
      projectId: this.instance.projectId,
      agentId: this.instance.id,
      taskId: task.id,
    });
  }

  // =========================================================================
  // COST TRACKING
  // =========================================================================

  private recordCost(response: GenerateResult, task: Task): void {
    try {
      // Estimate cost (approximate pricing per 1M tokens)
      const pricing: Record<string, { input: number; output: number }> = {
        'claude-sonnet': { input: 3, output: 15 },
        'claude-opus': { input: 15, output: 75 },
        'gpt-4o': { input: 2.5, output: 10 },
        'default': { input: 3, output: 15 },
      };

      const model = response.model.toLowerCase();
      const price = Object.entries(pricing).find(([k]) => model.includes(k))?.[1] ?? pricing.default;
      const costUsd = (response.usage.inputTokens * price.input + response.usage.outputTokens * price.output) / 1_000_000;

      this.costRepo.record({
        traceId: task.id,
        agentId: this.instance.id,
        taskId: task.id,
        projectId: this.instance.projectId,
        provider: this.deps.llmProvider.type,
        model: response.model,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        costUsd,
      });

      this.deps.eventBus.emit('cost.recorded', {
        agentId: this.instance.id,
        costUsd,
        totalTokens: response.usage.totalTokens,
      }, {
        source: `agent:${this.instance.id}`,
        projectId: this.instance.projectId,
        agentId: this.instance.id,
        taskId: task.id,
      });
    } catch {
      // Cost tracking failure is non-fatal
    }
  }

  // =========================================================================
  // HELPERS
  // =========================================================================

  private transitionToIdle(turnCount: number): void {
    this.instance.status = 'idle';
    this.instance.currentTaskId = undefined;
    this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'idle', {
      currentTaskId: null,
      turnCount,
    });

    this.deps.eventBus.emit('agent.idle', {
      agentId: this.instance.id,
      previousStatus: 'working',
    }, {
      source: `agent:${this.instance.id}`,
      projectId: this.instance.projectId,
      agentId: this.instance.id,
    });
  }

  private estimateTokens(messages: LLMMessage[]): number {
    return messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
  }

  private async getProjectPath(): Promise<string> {
    const { ProjectRepository } = await import('@h/db');
    const repo = new ProjectRepository();
    const project = repo.findById(this.instance.projectId);
    return project?.path ?? process.cwd();
  }
}

import type { AgentInstance, AgentDefinition, Task } from '@h/types';
import type { EventBus } from '@h/events';
import type { TaskService } from '@h/tasks';
import type { TerminalManager, ClaudeCodeEvent } from '@h/terminal';
import { AgentRepository, CostRepository, TraceRepository } from '@h/db';

export interface ClaudeCodeRuntimeDeps {
  eventBus: EventBus;
  taskService: TaskService;
  terminalManager: TerminalManager;
  agentRepo: AgentRepository;
  mcpConfigPath?: string;
}

/**
 * Runs a task by spawning a real Claude Code CLI process.
 * Parses stream-json output to track progress, tool use, and completion.
 */
export class ClaudeCodeRuntime {
  private instance: AgentInstance;
  private definition: AgentDefinition;
  private deps: ClaudeCodeRuntimeDeps;
  private running = false;
  private terminalId?: string;
  private costRepo = new CostRepository();
  private traceRepo = new TraceRepository();
  private taskStartTime = 0;

  constructor(instance: AgentInstance, definition: AgentDefinition, deps: ClaudeCodeRuntimeDeps) {
    this.instance = instance;
    this.definition = definition;
    this.deps = deps;
  }

  get id(): string { return this.instance.id; }
  get status(): string { return this.instance.status; }
  get isRunning(): boolean { return this.running; }

  async start(task: Task): Promise<void> {
    this.running = true;
    this.taskStartTime = Date.now();

    this.instance.status = 'working';
    this.instance.currentTaskId = task.id;
    this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'working', {
      currentTaskId: task.id,
    });

    await this.deps.eventBus.emit('agent.started', {
      agentId: this.instance.id,
      runtimeType: 'claude_code_automated',
    }, {
      source: `agent:${this.instance.id}`,
      sessionId: this.instance.sessionId,
      projectId: this.instance.projectId,
      agentId: this.instance.id,
      taskId: task.id,
    });

    await this.deps.taskService.start(task.id, this.instance.id);

    try {
      await this.runClaudeCode(task);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.deps.taskService.fail(task.id, msg);
      this.instance.status = 'error';
      this.instance.errorMessage = msg;
      this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'error', { errorMessage: msg });

      await this.deps.eventBus.emit('agent.error', {
        agentId: this.instance.id,
        error: msg,
      }, {
        source: `agent:${this.instance.id}`,
        sessionId: this.instance.sessionId,
        projectId: this.instance.projectId,
        agentId: this.instance.id,
        taskId: task.id,
      });
    }
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.terminalId) {
      await this.deps.terminalManager.kill(this.terminalId);
    }

    this.instance.status = 'terminated';
    this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'terminated');

    await this.deps.eventBus.emit('agent.terminated', {
      agentId: this.instance.id,
      reason: 'Manual stop',
    }, {
      source: `agent:${this.instance.id}`,
      sessionId: this.instance.sessionId,
      projectId: this.instance.projectId,
      agentId: this.instance.id,
    });
  }

  private async runClaudeCode(task: Task): Promise<void> {
    // Build prompt from task
    const prompt = this.buildPrompt(task);

    // Get project path
    const { ProjectRepository } = await import('@h/db');
    const projectRepo = new ProjectRepository();
    const project = projectRepo.findById(this.instance.projectId);
    const cwd = project?.path ?? process.cwd();

    // Spawn Claude Code
    const terminal = await this.deps.terminalManager.spawnClaudeCode({
      sessionId: this.instance.sessionId ?? '',
      projectId: this.instance.projectId,
      agentId: this.instance.id,
      name: `${this.definition.role}-${this.instance.id.slice(0, 8)}`,
      type: 'claude_code_automated',
      command: 'claude',
      cwd,
      prompt,
      mcpConfigPath: this.deps.mcpConfigPath,
    });

    this.terminalId = terminal.id;

    // Wait for process to complete
    return new Promise<void>((resolve, reject) => {
      let completed = false;
      let resultSummary = '';
      let filesChanged: string[] = [];

      this.deps.terminalManager.onClaudeCodeEvent(terminal.id, async (event: ClaudeCodeEvent) => {
        try {
          await this.handleClaudeCodeEvent(event, task);

          // Track result data
          if (event.type === 'result') {
            completed = true;
            resultSummary = (event.data.result as string) ?? (event.data.content as string) ?? 'Task completed';
          }

          if (event.type === 'tool_use') {
            const name = event.data.name as string;
            const input = event.data.input as Record<string, unknown> | undefined;
            if ((name === 'Write' || name === 'Edit') && input?.file_path) {
              filesChanged.push(input.file_path as string);
            }
          }
        } catch { /* non-fatal */ }
      });

      // Listen for process exit
      const checkInterval = setInterval(() => {
        const t = this.deps.terminalManager.getTerminal(terminal.id);
        if (!t || t.status === 'completed' || t.status === 'crashed' || t.status === 'stopped') {
          clearInterval(checkInterval);

          if (completed || (t && t.status === 'completed')) {
            this.deps.taskService.complete(task.id, {
              success: true,
              summary: resultSummary || 'Claude Code completed',
              filesChanged: [...new Set(filesChanged)],
              linesAdded: 0,
              linesRemoved: 0,
            }).then(() => {
              this.transitionToIdle();
              resolve();
            });
          } else {
            const exitCode = t?.exitCode;
            const errMsg = `Claude Code exited with code ${exitCode}`;
            this.deps.taskService.fail(task.id, errMsg).then(() => {
              this.transitionToIdle();
              if (exitCode !== 0) reject(new Error(errMsg));
              else resolve();
            });
          }
        }
      }, 500);
    });
  }

  private async handleClaudeCodeEvent(event: ClaudeCodeEvent, task: Task): Promise<void> {
    switch (event.type) {
      case 'assistant':
        // Progress update
        const text = (event.data.content as string) ?? (event.data.text as string) ?? '';
        if (text) {
          await this.deps.taskService.progress(task.id, text.slice(0, 200));
          await this.deps.eventBus.emit('agent.progress', {
            agentId: this.instance.id,
            summary: text.slice(0, 200),
          }, {
            source: `agent:${this.instance.id}`,
            sessionId: this.instance.sessionId,
            projectId: this.instance.projectId,
            agentId: this.instance.id,
            taskId: task.id,
          });
        }
        break;

      case 'tool_use':
        await this.deps.eventBus.emit('claude_code.tool_use', {
          agentId: this.instance.id,
          tool: event.data.name,
          input: event.data.input,
        }, {
          source: `agent:${this.instance.id}`,
          sessionId: this.instance.sessionId,
          projectId: this.instance.projectId,
          agentId: this.instance.id,
          taskId: task.id,
        });
        break;

      case 'usage':
        // Track cost
        const usage = event.data as { input_tokens?: number; output_tokens?: number; model?: string };
        if (usage.input_tokens || usage.output_tokens) {
          const inputTokens = usage.input_tokens ?? 0;
          const outputTokens = usage.output_tokens ?? 0;
          // Estimate cost (Sonnet pricing)
          const costUsd = (inputTokens * 3 + outputTokens * 15) / 1_000_000;
          this.costRepo.record({
            traceId: task.id,
            agentId: this.instance.id,
            taskId: task.id,
            projectId: this.instance.projectId,
            provider: 'claude-code',
            model: (usage.model as string) ?? 'claude-sonnet',
            inputTokens,
            outputTokens,
            costUsd,
          });
        }
        break;

      case 'error':
        await this.deps.eventBus.emit('claude_code.error', {
          agentId: this.instance.id,
          error: event.data.error ?? event.data.message ?? 'Unknown error',
        }, {
          source: `agent:${this.instance.id}`,
          sessionId: this.instance.sessionId,
          projectId: this.instance.projectId,
          agentId: this.instance.id,
          taskId: task.id,
        });
        break;
    }
  }

  private buildPrompt(task: Task): string {
    return [
      `You are a ${this.definition.role} agent working on a task.`,
      '',
      `## Task: ${task.title}`,
      '',
      task.description,
      '',
      'Complete this task thoroughly. When done, provide a summary of what you accomplished.',
    ].join('\n');
  }

  private transitionToIdle(): void {
    this.running = false;
    this.instance.status = 'idle';
    this.instance.currentTaskId = undefined;
    this.deps.agentRepo.updateInstanceStatus(this.instance.id, 'idle', {
      currentTaskId: null,
    });

    this.deps.eventBus.emit('agent.idle', {
      agentId: this.instance.id,
    }, {
      source: `agent:${this.instance.id}`,
      sessionId: this.instance.sessionId,
      projectId: this.instance.projectId,
      agentId: this.instance.id,
    });
  }
}

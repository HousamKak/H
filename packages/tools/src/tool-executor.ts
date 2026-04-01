import type { ToolDefinition, ToolExecutionRequest, ToolExecutionResult } from '@h/types';
import type { EventBus } from '@h/events';

export type ToolHandler = (args: Record<string, unknown>, context: { workingDirectory?: string }) => Promise<ToolExecutionResult>;

export class ToolExecutor {
  private tools: Map<string, { definition: ToolDefinition; handler: ToolHandler }> = new Map();
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  getDefinitions(): ToolDefinition[] {
    return [...this.tools.values()]
      .filter((t) => t.definition.isEnabled)
      .map((t) => t.definition);
  }

  getDefinition(name: string): ToolDefinition | undefined {
    return this.tools.get(name)?.definition;
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const tool = this.tools.get(request.toolName);
    if (!tool) {
      return { success: false, output: null, error: `Tool '${request.toolName}' not found`, durationMs: 0 };
    }

    if (!tool.definition.isEnabled) {
      return { success: false, output: null, error: `Tool '${request.toolName}' is disabled`, durationMs: 0 };
    }

    const startTime = Date.now();

    await this.eventBus.emit('tool.invoked', {
      toolCall: { id: `call-${Date.now()}`, toolName: request.toolName, arguments: request.arguments },
      agentId: request.agentId,
    }, {
      source: 'tool-executor',
      projectId: request.projectId,
      agentId: request.agentId,
      taskId: request.taskId,
    });

    try {
      const result = await tool.handler(request.arguments, {
        workingDirectory: request.workingDirectory,
      });

      const durationMs = Date.now() - startTime;
      const finalResult = { ...result, durationMs };

      await this.eventBus.emit('tool.completed', {
        toolResult: { callId: request.toolName, ...finalResult },
        agentId: request.agentId,
      }, {
        source: 'tool-executor',
        projectId: request.projectId,
        agentId: request.agentId,
        taskId: request.taskId,
      });

      return finalResult;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);

      await this.eventBus.emit('tool.error', {
        toolName: request.toolName,
        error,
        agentId: request.agentId,
      }, {
        source: 'tool-executor',
        projectId: request.projectId,
        agentId: request.agentId,
        taskId: request.taskId,
      });

      return { success: false, output: null, error, durationMs };
    }
  }
}

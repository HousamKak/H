import type { AgentInstance, AgentDefinition, AgentRole, SpawnAgentInput, Task } from '@h/types';
import { AgentRepository } from '@h/db';
import type { EventBus } from '@h/events';
import type { ProviderRegistry } from '@h/llm';
import type { ToolExecutor } from '@h/tools';
import type { MemoryService } from '@h/memory';
import type { TaskService } from '@h/tasks';
import { AgentRuntime } from './agent-runtime.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class AgentService {
  private agentRepo: AgentRepository;
  private eventBus: EventBus;
  private providerRegistry: ProviderRegistry;
  private toolExecutor: ToolExecutor;
  private memoryService: MemoryService;
  private taskService: TaskService;
  private runtimes: Map<string, AgentRuntime> = new Map();
  private schemasDir: string;

  constructor(deps: {
    eventBus: EventBus;
    providerRegistry: ProviderRegistry;
    toolExecutor: ToolExecutor;
    memoryService: MemoryService;
    taskService: TaskService;
    schemasDir: string;
  }) {
    this.agentRepo = new AgentRepository();
    this.eventBus = deps.eventBus;
    this.providerRegistry = deps.providerRegistry;
    this.toolExecutor = deps.toolExecutor;
    this.memoryService = deps.memoryService;
    this.taskService = deps.taskService;
    this.schemasDir = deps.schemasDir;
  }

  async loadDefinitions(): Promise<void> {
    const roles: AgentRole[] = ['coder', 'reviewer', 'researcher', 'architect', 'foreman'];
    for (const role of roles) {
      try {
        const schemaPath = join(this.schemasDir, 'agents', `${role}.json`);
        const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
        this.agentRepo.upsertDefinition(schema as AgentDefinition);
      } catch (err) {
        console.warn(`Failed to load agent definition for ${role}:`, err);
      }
    }
  }

  getDefinition(role: AgentRole): AgentDefinition | undefined {
    return this.agentRepo.findDefinition(role);
  }

  getAllDefinitions(): AgentDefinition[] {
    return this.agentRepo.findAllDefinitions();
  }

  async spawn(input: SpawnAgentInput): Promise<AgentInstance> {
    const definition = this.agentRepo.findDefinition(input.role);
    if (!definition) {
      throw new Error(`No agent definition found for role: ${input.role}`);
    }

    const instance = this.agentRepo.createInstance(input, definition.tokenBudget);

    // Create runtime
    const llmProvider = this.providerRegistry.get(definition.llmProvider);
    const runtime = new AgentRuntime(instance, definition, {
      eventBus: this.eventBus,
      llmProvider,
      toolExecutor: this.toolExecutor,
      memoryService: this.memoryService,
      taskService: this.taskService,
      agentRepo: this.agentRepo,
    });

    this.runtimes.set(instance.id, runtime);

    // Transition to idle
    this.agentRepo.updateInstanceStatus(instance.id, 'idle');

    await this.eventBus.emit('agent.spawned', { agent: instance }, {
      source: 'agent-service',
      projectId: input.projectId,
      agentId: instance.id,
    });

    return { ...instance, status: 'idle' };
  }

  async assignTask(agentId: string, task: Task): Promise<void> {
    const runtime = this.runtimes.get(agentId);
    if (!runtime) throw new Error(`No runtime found for agent ${agentId}`);

    // Run the task in the background (non-blocking)
    runtime.start(task).catch((err) => {
      console.error(`Agent ${agentId} failed on task ${task.id}:`, err);
    });
  }

  async stopAgent(agentId: string): Promise<void> {
    const runtime = this.runtimes.get(agentId);
    if (runtime) {
      await runtime.stop();
      this.runtimes.delete(agentId);
    }
  }

  getRuntime(agentId: string): AgentRuntime | undefined {
    return this.runtimes.get(agentId);
  }

  getActiveAgents(projectId?: string): AgentInstance[] {
    return this.agentRepo.findAllInstances({
      projectId,
      status: undefined, // Get all non-terminated
    }).filter((a) => a.status !== 'terminated');
  }

  getIdleAgents(projectId?: string): AgentInstance[] {
    return this.agentRepo.findAllInstances({ projectId, status: 'idle' });
  }
}

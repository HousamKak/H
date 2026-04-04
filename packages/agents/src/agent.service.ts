import type { AgentInstance, AgentDefinition, AgentRole, SpawnAgentInput, Task } from '@h/types';
import { AgentRepository } from '@h/db';
import type { EventBus } from '@h/events';
import type { ProviderRegistry } from '@h/llm';
import type { ToolExecutor } from '@h/tools';
import type { MemoryService, BlackboardService } from '@h/memory';
import type { TaskService } from '@h/tasks';
import type { TerminalManager } from '@h/terminal';
import { AgentRuntime } from './agent-runtime.js';
import { ClaudeCodeRuntime } from './claude-code-runtime.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class AgentService {
  private agentRepo: AgentRepository;
  private eventBus: EventBus;
  private providerRegistry: ProviderRegistry;
  private toolExecutor: ToolExecutor;
  private memoryService: MemoryService;
  private blackboard: BlackboardService;
  private taskService: TaskService;
  private terminalManager?: TerminalManager;
  private internalRuntimes: Map<string, AgentRuntime> = new Map();
  private ccRuntimes: Map<string, ClaudeCodeRuntime> = new Map();
  private schemasDir: string;

  constructor(deps: {
    eventBus: EventBus;
    providerRegistry: ProviderRegistry;
    toolExecutor: ToolExecutor;
    memoryService: MemoryService;
    blackboard: BlackboardService;
    taskService: TaskService;
    schemasDir: string;
    terminalManager?: TerminalManager;
  }) {
    this.agentRepo = new AgentRepository();
    this.eventBus = deps.eventBus;
    this.providerRegistry = deps.providerRegistry;
    this.toolExecutor = deps.toolExecutor;
    this.memoryService = deps.memoryService;
    this.blackboard = deps.blackboard;
    this.taskService = deps.taskService;
    this.schemasDir = deps.schemasDir;
    this.terminalManager = deps.terminalManager;
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
    const runtimeType = input.runtimeType ?? 'internal';

    if (runtimeType === 'internal') {
      // Internal LLM loop runtime
      const llmProvider = this.providerRegistry.get(definition.llmProvider);
      const runtime = new AgentRuntime(instance, definition, {
        eventBus: this.eventBus,
        llmProvider,
        toolExecutor: this.toolExecutor,
        memoryService: this.memoryService,
        blackboard: this.blackboard,
        taskService: this.taskService,
        agentRepo: this.agentRepo,
      });
      this.internalRuntimes.set(instance.id, runtime);
    } else if (runtimeType.startsWith('claude_code') && this.terminalManager) {
      // Claude Code process runtime
      const ccRuntime = new ClaudeCodeRuntime(instance, definition, {
        eventBus: this.eventBus,
        taskService: this.taskService,
        terminalManager: this.terminalManager,
        agentRepo: this.agentRepo,
      });
      this.ccRuntimes.set(instance.id, ccRuntime);
    } else {
      // Fallback to internal
      const llmProvider = this.providerRegistry.get(definition.llmProvider);
      const runtime = new AgentRuntime(instance, definition, {
        eventBus: this.eventBus,
        llmProvider,
        toolExecutor: this.toolExecutor,
        memoryService: this.memoryService,
        blackboard: this.blackboard,
        taskService: this.taskService,
        agentRepo: this.agentRepo,
      });
      this.internalRuntimes.set(instance.id, runtime);
    }

    // Transition to idle
    this.agentRepo.updateInstanceStatus(instance.id, 'idle');

    await this.eventBus.emit('agent.spawned', { agent: instance }, {
      source: 'agent-service',
      sessionId: input.sessionId,
      projectId: input.projectId,
      agentId: instance.id,
    });

    return { ...instance, status: 'idle' };
  }

  async assignTask(agentId: string, task: Task): Promise<void> {
    // Check internal runtimes first
    const internalRuntime = this.internalRuntimes.get(agentId);
    if (internalRuntime) {
      internalRuntime.start(task).catch((err) => {
        console.error(`Agent ${agentId} failed on task ${task.id}:`, err);
      });
      return;
    }

    // Check Claude Code runtimes
    const ccRuntime = this.ccRuntimes.get(agentId);
    if (ccRuntime) {
      ccRuntime.start(task).catch((err) => {
        console.error(`CC Agent ${agentId} failed on task ${task.id}:`, err);
      });
      return;
    }

    throw new Error(`No runtime found for agent ${agentId}`);
  }

  async stopAgent(agentId: string): Promise<void> {
    const internalRuntime = this.internalRuntimes.get(agentId);
    if (internalRuntime) {
      await internalRuntime.stop();
      this.internalRuntimes.delete(agentId);
      return;
    }

    const ccRuntime = this.ccRuntimes.get(agentId);
    if (ccRuntime) {
      await ccRuntime.stop();
      this.ccRuntimes.delete(agentId);
      return;
    }
  }

  getRuntime(agentId: string): AgentRuntime | undefined {
    return this.internalRuntimes.get(agentId);
  }

  getActiveAgents(projectId?: string): AgentInstance[] {
    return this.agentRepo.findAllInstances({
      projectId,
      status: undefined,
    }).filter((a) => a.status !== 'terminated');
  }

  getIdleAgents(projectId?: string): AgentInstance[] {
    return this.agentRepo.findAllInstances({ projectId, status: 'idle' });
  }
}

import type { Project, CreateProjectInput, CreateTaskInput, AgentRole, Task, AgentInstance } from '@h/types';
import { generateId } from '@h/types';
import { EventBus } from '@h/events';
import { getDatabase, ProjectRepository, EventRepository } from '@h/db';
import { ProviderRegistry } from '@h/llm';
import { MemoryService } from '@h/memory';
import { TaskService, TaskQueue } from '@h/tasks';
import { createToolExecutor } from '@h/tools';
import { AgentService } from '@h/agents';
import { StatusReporter } from './status-reporter.js';
import { CommandParser } from './command-parser.js';
import { resolve } from 'node:path';

export class Orchestrator {
  private eventBus: EventBus;
  private projectRepo: ProjectRepository;
  private eventRepo: EventRepository;
  private providerRegistry: ProviderRegistry;
  private memoryService: MemoryService;
  private taskService: TaskService;
  private taskQueue: TaskQueue;
  private agentService: AgentService;
  private statusReporter: StatusReporter;
  private commandParser: CommandParser;
  private currentProjectId?: string;
  private assignmentInterval?: ReturnType<typeof setInterval>;

  constructor(schemasDir: string, dbPath?: string) {
    // Initialize database
    getDatabase(dbPath);

    // Core services
    this.eventBus = new EventBus();
    this.projectRepo = new ProjectRepository();
    this.eventRepo = new EventRepository();
    this.providerRegistry = ProviderRegistry.createDefault();
    this.memoryService = new MemoryService(this.eventBus);
    this.taskService = new TaskService(this.eventBus);
    this.taskQueue = new TaskQueue(this.taskService);

    const toolExecutor = createToolExecutor(this.eventBus);

    this.agentService = new AgentService({
      eventBus: this.eventBus,
      providerRegistry: this.providerRegistry,
      toolExecutor,
      memoryService: this.memoryService,
      taskService: this.taskService,
      schemasDir,
    });

    this.statusReporter = new StatusReporter(this.projectRepo, this.agentService, this.taskService, this.taskQueue);
    this.commandParser = new CommandParser();

    // Persist events to DB
    this.eventBus.onPersist((event) => {
      this.eventRepo.insert(event);
    });
  }

  async initialize(): Promise<void> {
    await this.agentService.loadDefinitions();

    await this.eventBus.emit('system.started', { message: 'H Assistant initialized' }, {
      source: 'orchestrator',
    });

    // Start task assignment loop
    this.assignmentInterval = setInterval(() => this.assignPendingTasks(), 2000);
  }

  async shutdown(): Promise<void> {
    if (this.assignmentInterval) clearInterval(this.assignmentInterval);

    // Stop all agents
    const agents = this.agentService.getActiveAgents();
    for (const agent of agents) {
      await this.agentService.stopAgent(agent.id);
    }

    await this.eventBus.emit('system.shutdown', { message: 'H Assistant shutting down' }, {
      source: 'orchestrator',
    });

    this.eventBus.clear();
  }

  // ---- Project Management ----

  createProject(input: CreateProjectInput): Project {
    return this.projectRepo.create(input);
  }

  getProjects(): Project[] {
    return this.projectRepo.findAll();
  }

  getProject(idOrName: string): Project | undefined {
    return this.projectRepo.findById(idOrName) ?? this.projectRepo.findByName(idOrName);
  }

  setCurrentProject(idOrName: string): Project | undefined {
    const project = this.getProject(idOrName);
    if (project) this.currentProjectId = project.id;
    return project;
  }

  getCurrentProject(): Project | undefined {
    return this.currentProjectId ? this.projectRepo.findById(this.currentProjectId) : undefined;
  }

  // ---- Task Management ----

  async createTask(input: CreateTaskInput): Promise<Task> {
    return this.taskService.create(input);
  }

  getTasks(projectId?: string): Task[] {
    return this.taskService.findAll({ projectId: projectId ?? this.currentProjectId });
  }

  getTask(id: string): Task | undefined {
    return this.taskService.findById(id);
  }

  // ---- Agent Management ----

  async spawnAgent(role: AgentRole, projectId?: string): Promise<AgentInstance> {
    const pid = projectId ?? this.currentProjectId;
    if (!pid) throw new Error('No project selected. Use setCurrentProject() first.');
    return this.agentService.spawn({ role, projectId: pid });
  }

  async stopAgent(agentId: string): Promise<void> {
    return this.agentService.stopAgent(agentId);
  }

  getAgents(projectId?: string): AgentInstance[] {
    return this.agentService.getActiveAgents(projectId ?? this.currentProjectId);
  }

  // ---- Command Processing ----

  async handleMessage(message: string, source: string = 'system'): Promise<string> {
    const command = this.commandParser.parse(message);

    await this.eventBus.emit('message.received', { content: message, source }, {
      source,
      projectId: this.currentProjectId,
    });

    let response: string;

    switch (command.type) {
      case 'status':
        response = this.statusReporter.getFullStatus(this.currentProjectId);
        break;

      case 'projects':
        response = this.statusReporter.getProjectList();
        break;

      case 'project':
        if (command.args.name) {
          const p = this.setCurrentProject(command.args.name);
          response = p ? `Switched to project: ${p.name}` : `Project '${command.args.name}' not found`;
        } else {
          const current = this.getCurrentProject();
          response = current ? this.statusReporter.getProjectDetail(current.id) : 'No project selected';
        }
        break;

      case 'task': {
        const pid = this.currentProjectId;
        if (!pid) { response = 'No project selected. Use /project <name> first.'; break; }
        const task = await this.createTask({
          projectId: pid,
          title: command.args.title ?? message,
          description: command.args.description ?? message,
          priority: command.args.priority,
          requiredRole: command.args.role,
        });
        response = `Task created: [${task.priority}] ${task.title} (${task.id})`;
        break;
      }

      case 'agents':
        response = this.statusReporter.getAgentList(this.currentProjectId);
        break;

      case 'spawn': {
        const pid = this.currentProjectId;
        if (!pid) { response = 'No project selected.'; break; }
        const agent = await this.spawnAgent(command.args.role as AgentRole, pid);
        response = `Spawned ${agent.definitionRole} agent: ${agent.id}`;
        break;
      }

      case 'stop':
        await this.stopAgent(command.args.agentId);
        response = `Stopped agent: ${command.args.agentId}`;
        break;

      case 'memory': {
        const memories = await this.memoryService.recall({
          projectId: this.currentProjectId,
          limit: 10,
        });
        response = memories.length > 0
          ? memories.map((m) => `[${m.type}] ${m.content}`).join('\n')
          : 'No memories found';
        break;
      }

      default:
        // Free-text: create a task
        if (this.currentProjectId) {
          const task = await this.createTask({
            projectId: this.currentProjectId,
            title: message.substring(0, 100),
            description: message,
          });
          response = `Task created from message: ${task.title} (${task.id})`;
        } else {
          response = 'No project selected. Use /project <name> first, or /projects to list available projects.';
        }
    }

    await this.eventBus.emit('message.sent', { content: response, target: source }, {
      source: 'orchestrator',
      projectId: this.currentProjectId,
    });

    return response;
  }

  // ---- Internals ----

  private async assignPendingTasks(): Promise<void> {
    const readyTasks = this.taskService.findPendingReady();

    for (const task of readyTasks) {
      const idleAgents = this.agentService.getIdleAgents(task.projectId);
      const matchingAgent = idleAgents.find((a) => a.definitionRole === task.requiredRole);

      if (matchingAgent) {
        await this.taskService.assign(task.id, matchingAgent.id);
        await this.agentService.assignTask(matchingAgent.id, task);
      }
    }
  }

  // ---- Accessors for interface layers ----

  get events(): EventBus { return this.eventBus; }
  get memory(): MemoryService { return this.memoryService; }
  get tasks(): TaskService { return this.taskService; }
  get queue(): TaskQueue { return this.taskQueue; }
  get agents(): AgentService { return this.agentService; }
  get status(): StatusReporter { return this.statusReporter; }
}

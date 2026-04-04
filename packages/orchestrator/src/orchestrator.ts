import type {
  Project, CreateProjectInput, CreateTaskInput, AgentRole, Task, AgentInstance, CostLimits,
  Session, CreateSessionInput, SessionStatus, ProjectLink, CreateProjectLinkInput,
} from '@h/types';
import { generateId } from '@h/types';
import { EventBus } from '@h/events';
import { getDatabase, ProjectRepository, EventRepository, CostRepository, TaskGraphRepository } from '@h/db';
import { ProviderRegistry } from '@h/llm';
import { MemoryService, BlackboardService } from '@h/memory';
import { TaskService, TaskQueue, TaskGraphService } from '@h/tasks';
import { createToolExecutor } from '@h/tools';
import { AgentService } from '@h/agents';
import { SessionService } from '@h/session';
import { AgentCardRegistry, A2ARouter } from '@h/a2a';
import { TerminalManager } from '@h/terminal';
import { StatusReporter } from './status-reporter.js';
import { CommandParser } from './command-parser.js';
import { resolve } from 'node:path';

export class Orchestrator {
  private eventBus: EventBus;
  private projectRepo: ProjectRepository;
  private eventRepo: EventRepository;
  private costRepo: CostRepository;
  private providerRegistry: ProviderRegistry;
  private memoryService: MemoryService;
  private blackboardService: BlackboardService;
  private taskService: TaskService;
  private taskQueue: TaskQueue;
  private taskGraphService: TaskGraphService;
  private agentService: AgentService;
  private sessionService: SessionService;
  private agentCardRegistry: AgentCardRegistry;
  private a2aRouter: A2ARouter;
  private terminalManager: TerminalManager;
  private statusReporter: StatusReporter;
  private commandParser: CommandParser;
  private currentSessionId?: string;
  private currentProjectId?: string; // active project within session
  private assignmentInterval?: ReturnType<typeof setInterval>;
  private costLimits: CostLimits = { perTask: 5, perGraph: 20, daily: 50, perAgent: 10 };

  constructor(schemasDir: string, dbPath?: string) {
    getDatabase(dbPath);

    // Core services
    this.eventBus = new EventBus();
    this.projectRepo = new ProjectRepository();
    this.eventRepo = new EventRepository();
    this.costRepo = new CostRepository();
    this.providerRegistry = ProviderRegistry.createDefault();
    this.memoryService = new MemoryService(this.eventBus);
    this.blackboardService = new BlackboardService(this.eventBus);
    this.taskService = new TaskService(this.eventBus);
    this.taskQueue = new TaskQueue(this.taskService);
    this.sessionService = new SessionService(this.eventBus);
    this.agentCardRegistry = new AgentCardRegistry(this.eventBus);
    this.a2aRouter = new A2ARouter(this.eventBus, this.agentCardRegistry);
    this.terminalManager = new TerminalManager(this.eventBus);

    const graphRepo = new TaskGraphRepository();
    this.taskGraphService = new TaskGraphService(this.taskService, this.eventBus, graphRepo);

    const toolExecutor = createToolExecutor(this.eventBus);

    this.agentService = new AgentService({
      eventBus: this.eventBus,
      providerRegistry: this.providerRegistry,
      toolExecutor,
      memoryService: this.memoryService,
      blackboard: this.blackboardService,
      taskService: this.taskService,
      schemasDir,
      terminalManager: this.terminalManager,
    });

    this.statusReporter = new StatusReporter(this.projectRepo, this.agentService, this.taskService, this.taskQueue, this.sessionService);
    this.commandParser = new CommandParser();

    // Persist events to DB
    this.eventBus.onPersist((event) => {
      this.eventRepo.insert(event);
    });

    // Monitor cost thresholds
    this.eventBus.on('cost.recorded', (event) => {
      this.checkCostThresholds(event.payload as any);
    });

    // Auto-advance task graphs when tasks complete
    this.eventBus.on('task.completed', (event) => {
      this.onTaskCompleted(event.taskId);
    });

    // Auto-register agent cards for A2A discovery
    this.eventBus.on('agent.spawned', (event) => {
      const agent = (event.payload as any).agent;
      if (agent && this.currentSessionId) {
        this.agentCardRegistry.register({
          agentId: agent.id,
          name: `${agent.definitionRole}-${agent.id.slice(0, 8)}`,
          description: `${agent.definitionRole} agent`,
          projectId: agent.projectId,
          sessionId: this.currentSessionId,
          capabilities: [agent.definitionRole],
        });
      }
    });

    // Auto-unregister on termination
    this.eventBus.on('agent.terminated', (event) => {
      const agentId = (event.payload as any).agentId ?? event.agentId;
      if (agentId) {
        this.agentCardRegistry.unregister(agentId);
        this.a2aRouter.unregisterHandler(agentId);
      }
    });

    // Update card status when agent starts/stops working
    this.eventBus.on('agent.started', (event) => {
      if (event.agentId) this.agentCardRegistry.updateStatus(event.agentId, 'busy');
    });
    this.eventBus.on('agent.idle', (event) => {
      if (event.agentId) this.agentCardRegistry.updateStatus(event.agentId, 'available');
    });
  }

  async initialize(): Promise<void> {
    await this.agentService.loadDefinitions();

    // Restore active session if one exists
    const activeSession = this.sessionService.getActiveSession();
    if (activeSession) {
      this.currentSessionId = activeSession.id;
      const primaryProjectId = this.sessionService.getPrimaryProjectId(activeSession.id);
      if (primaryProjectId) this.currentProjectId = primaryProjectId;
    }

    await this.eventBus.emit('system.started', { message: 'H Assistant initialized' }, {
      source: 'orchestrator',
      sessionId: this.currentSessionId,
    });

    // Start task assignment loop
    this.assignmentInterval = setInterval(() => this.assignPendingTasks(), 2000);
  }

  async shutdown(): Promise<void> {
    if (this.assignmentInterval) clearInterval(this.assignmentInterval);

    const agents = this.agentService.getActiveAgents();
    for (const agent of agents) {
      await this.agentService.stopAgent(agent.id);
    }

    await this.eventBus.emit('system.shutdown', { message: 'H Assistant shutting down' }, {
      source: 'orchestrator',
      sessionId: this.currentSessionId,
    });

    this.eventBus.clear();
  }

  // ---- Session Management ----

  async startSession(input: CreateSessionInput): Promise<Session> {
    const session = await this.sessionService.startSession(input);
    this.currentSessionId = session.id;
    const projectIds = this.sessionService.getSessionProjectIds(session.id);
    if (projectIds.length > 0) this.currentProjectId = projectIds[0];
    return session;
  }

  async pauseSession(): Promise<void> {
    if (!this.currentSessionId) throw new Error('No active session');
    await this.sessionService.pauseSession(this.currentSessionId);
    this.currentSessionId = undefined;
    this.currentProjectId = undefined;
  }

  async resumeSession(sessionId: string): Promise<Session> {
    const session = await this.sessionService.resumeSession(sessionId);
    this.currentSessionId = session.id;
    const primaryProjectId = this.sessionService.getPrimaryProjectId(session.id);
    if (primaryProjectId) this.currentProjectId = primaryProjectId;
    return session;
  }

  async completeSession(): Promise<void> {
    if (!this.currentSessionId) throw new Error('No active session');
    await this.sessionService.completeSession(this.currentSessionId);
    this.currentSessionId = undefined;
    this.currentProjectId = undefined;
  }

  getActiveSession(): Session | undefined {
    return this.currentSessionId ? this.sessionService.getSession(this.currentSessionId) : undefined;
  }

  getSessions(filter?: { status?: SessionStatus }): Session[] {
    return this.sessionService.getAllSessions(filter);
  }

  async addProjectToSession(projectId: string, isPrimary = false): Promise<void> {
    if (!this.currentSessionId) throw new Error('No active session');
    await this.sessionService.addProject(this.currentSessionId, projectId, isPrimary);
    if (isPrimary || !this.currentProjectId) this.currentProjectId = projectId;
  }

  async removeProjectFromSession(projectId: string): Promise<void> {
    if (!this.currentSessionId) throw new Error('No active session');
    await this.sessionService.removeProject(this.currentSessionId, projectId);
    if (this.currentProjectId === projectId) {
      const ids = this.sessionService.getSessionProjectIds(this.currentSessionId);
      this.currentProjectId = ids[0];
    }
  }

  getSessionProjects(): Project[] {
    if (!this.currentSessionId) return [];
    return this.sessionService.getSessionProjects(this.currentSessionId);
  }

  // ---- Project Links ----

  async linkProjects(input: CreateProjectLinkInput): Promise<ProjectLink> {
    return this.sessionService.linkProjects(input);
  }

  getLinkedProjects(projectId: string) {
    return this.sessionService.getLinkedProjects(projectId);
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
    return this.taskService.create({
      ...input,
      sessionId: input.sessionId ?? this.currentSessionId,
    });
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
    return this.agentService.spawn({ role, projectId: pid, sessionId: this.currentSessionId });
  }

  async stopAgent(agentId: string): Promise<void> {
    return this.agentService.stopAgent(agentId);
  }

  getAgents(projectId?: string): AgentInstance[] {
    return this.agentService.getActiveAgents(projectId ?? this.currentProjectId);
  }

  // ---- Task Graph Management ----

  get graphs(): TaskGraphService { return this.taskGraphService; }

  // ---- Command Processing ----

  async handleMessage(message: string, source: string = 'system'): Promise<string> {
    const command = this.commandParser.parse(message);

    await this.eventBus.emit('message.received', { content: message, source }, {
      source,
      sessionId: this.currentSessionId,
      projectId: this.currentProjectId,
    });

    let response: string;

    switch (command.type) {
      case 'status':
        response = this.statusReporter.getFullStatus(this.currentProjectId, this.currentSessionId);
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

      case 'session':
        if (command.args.action === 'start') {
          const session = await this.startSession({
            name: command.args.name,
            focusDescription: command.args.focus,
          });
          response = `Session started: ${session.name ?? session.id}`;
        } else if (command.args.action === 'pause') {
          await this.pauseSession();
          response = 'Session paused';
        } else if (command.args.action === 'resume') {
          const session = await this.resumeSession(command.args.sessionId);
          response = `Session resumed: ${session.name ?? session.id}`;
        } else if (command.args.action === 'complete') {
          await this.completeSession();
          response = 'Session completed';
        } else {
          const active = this.getActiveSession();
          response = active
            ? this.statusReporter.getSessionStatus(active.id)
            : 'No active session. Use /session start <name>';
        }
        break;

      case 'sessions':
        response = this.statusReporter.getSessionList();
        break;

      case 'add-project':
        if (!this.currentSessionId) { response = 'No active session.'; break; }
        if (command.args.projectId) {
          await this.addProjectToSession(command.args.projectId, command.args.primary);
          response = `Project added to session`;
        } else {
          response = 'Usage: /add-project <project-name-or-id> [--primary]';
        }
        break;

      case 'link':
        if (command.args.sourceId && command.args.targetId) {
          const link = await this.linkProjects({
            sourceProjectId: command.args.sourceId,
            targetProjectId: command.args.targetId,
            linkType: command.args.linkType ?? 'related',
          });
          response = `Projects linked: ${link.linkType}`;
        } else {
          response = 'Usage: /link <project1> <project2> [--type frontend_backend]';
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

      case 'help':
        response = this.getHelpText();
        break;

      default:
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
      sessionId: this.currentSessionId,
      projectId: this.currentProjectId,
    });

    return response;
  }

  // ---- Enhanced Task Assignment (across all session projects) ----

  private async assignPendingTasks(): Promise<void> {
    const idleAgents = this.agentService.getIdleAgents();
    if (idleAgents.length === 0) return;

    for (const agent of idleAgents) {
      const task = this.taskQueue.getNextTaskScored(
        agent.definitionRole as AgentRole,
        agent.projectId,
      );

      if (task) {
        await this.taskService.assign(task.id, agent.id);
        await this.agentService.assignTask(agent.id, task);
      }
    }
  }

  // ---- Cost Monitoring ----

  private async checkCostThresholds(payload: { agentId?: string; costUsd: number }): Promise<void> {
    if (payload.agentId) {
      const agentTotal = this.costRepo.totalForAgent(payload.agentId);
      if (agentTotal >= this.costLimits.perAgent * 0.8) {
        await this.eventBus.emit('cost.threshold.warning', {
          scope: 'agent',
          agentId: payload.agentId,
          currentCost: agentTotal,
          limit: this.costLimits.perAgent,
        }, { source: 'orchestrator', sessionId: this.currentSessionId });
      }
    }

    const dailyTotal = this.costRepo.dailyTotal();
    if (dailyTotal >= this.costLimits.daily * 0.8) {
      await this.eventBus.emit('cost.threshold.warning', {
        scope: 'daily',
        currentCost: dailyTotal,
        limit: this.costLimits.daily,
      }, { source: 'orchestrator', sessionId: this.currentSessionId });
    }
  }

  // ---- Task Graph Auto-Advancement ----

  private async onTaskCompleted(taskId?: string): Promise<void> {
    if (!taskId) return;
    // Find if this task belongs to any graph and advance it
    const task = this.taskService.findById(taskId);
    if (!task) return;

    // Search all graphs for a node with this taskId
    const graphRepo = new TaskGraphRepository();
    const graphs = graphRepo.findByProject(task.projectId);
    for (const graph of graphs) {
      const node = graph.nodes.find(n => n.taskId === taskId);
      if (node) {
        await this.taskGraphService.onTaskCompleted(graph.id, node.id);
        break;
      }
    }
  }

  // ---- Help ----

  private getHelpText(): string {
    return [
      '## H Commands\n',
      '**Session:**',
      '  /session — Show active session',
      '  /session start <name> — Start new session',
      '  /session pause — Pause current session',
      '  /session complete — Complete current session',
      '  /sessions — List all sessions',
      '',
      '**Projects:**',
      '  /projects — List all projects',
      '  /project <name> — Switch to project',
      '  /add-project <name> — Add project to session',
      '  /link <proj1> <proj2> — Link two projects',
      '',
      '**Tasks & Agents:**',
      '  /task <description> — Create a task',
      '  /agents — List active agents',
      '  /spawn <role> — Spawn an agent (coder|reviewer|researcher|architect)',
      '  /stop <agentId> — Stop an agent',
      '',
      '**Other:**',
      '  /status — Full status report',
      '  /memory — Show project memories',
      '  /help — Show this help',
    ].join('\n');
  }

  // ---- Accessors ----

  get events(): EventBus { return this.eventBus; }
  get memory(): MemoryService { return this.memoryService; }
  get blackboard(): BlackboardService { return this.blackboardService; }
  get tasks(): TaskService { return this.taskService; }
  get queue(): TaskQueue { return this.taskQueue; }
  get agents(): AgentService { return this.agentService; }
  get sessions(): SessionService { return this.sessionService; }
  get a2a(): A2ARouter { return this.a2aRouter; }
  get agentCards(): AgentCardRegistry { return this.agentCardRegistry; }
  get terminals(): TerminalManager { return this.terminalManager; }
  get status(): StatusReporter { return this.statusReporter; }
  get costs(): CostRepository { return this.costRepo; }
}

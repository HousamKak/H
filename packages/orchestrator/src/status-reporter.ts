import type { ProjectRepository } from '@h/db';
import type { AgentService } from '@h/agents';
import type { TaskService, TaskQueue } from '@h/tasks';
import type { SessionService } from '@h/session';

export class StatusReporter {
  constructor(
    private projectRepo: ProjectRepository,
    private agentService: AgentService,
    private taskService: TaskService,
    private taskQueue: TaskQueue,
    private sessionService?: SessionService,
  ) {}

  getFullStatus(projectId?: string, sessionId?: string): string {
    const lines: string[] = ['## H Assistant Status\n'];

    // Session info
    if (sessionId && this.sessionService) {
      const session = this.sessionService.getSession(sessionId);
      if (session) {
        lines.push(`**Session:** ${session.name ?? session.id.slice(0, 8)} (${session.status})`);
        const projects = this.sessionService.getSessionProjects(sessionId);
        if (projects.length > 0) {
          lines.push(`**Session Projects:** ${projects.map(p => p.name).join(', ')}`);
        }
        lines.push('');
      }
    }

    // Current project
    if (projectId) {
      const project = this.projectRepo.findById(projectId);
      if (project) {
        lines.push(`**Active Project:** ${project.name}`);
        lines.push(`**Path:** ${project.path}`);
        lines.push('');
      }
    }

    // Agents
    const agents = this.agentService.getActiveAgents(projectId);
    lines.push(`**Agents:** ${agents.length} active`);
    for (const agent of agents) {
      const icon = agent.status === 'working' ? '>' : agent.status === 'idle' ? '-' : 'x';
      lines.push(`  [${icon}] ${agent.definitionRole} (${agent.id.substring(0, 8)}) -- ${agent.status}`);
    }
    lines.push('');

    // Task queue
    const snapshot = this.taskQueue.getQueueSnapshot(projectId);
    lines.push('**Tasks:**');
    lines.push(`  Pending: ${snapshot.pending} | In Progress: ${snapshot.inProgress} | Review: ${snapshot.review}`);
    lines.push(`  Completed: ${snapshot.completed} | Failed: ${snapshot.failed} | Blocked: ${snapshot.blocked}`);

    return lines.join('\n');
  }

  getSessionStatus(sessionId: string): string {
    if (!this.sessionService) return 'Session service not available';
    const session = this.sessionService.getSession(sessionId);
    if (!session) return 'Session not found';

    const projects = this.sessionService.getSessionProjects(sessionId);
    const lines = [
      `## Session: ${session.name ?? session.id.slice(0, 8)}`,
      `Status: ${session.status}`,
      `Started: ${session.startedAt}`,
      session.focusDescription ? `Focus: ${session.focusDescription}` : '',
      '',
      `**Projects (${projects.length}):**`,
    ];

    for (const p of projects) {
      const agents = this.agentService.getActiveAgents(p.id);
      const snapshot = this.taskQueue.getQueueSnapshot(p.id);
      lines.push(`  ${p.name} -- ${agents.length} agents, ${snapshot.pending} pending tasks`);
    }

    return lines.filter(Boolean).join('\n');
  }

  getSessionList(): string {
    if (!this.sessionService) return 'Session service not available';
    const sessions = this.sessionService.getAllSessions();
    if (sessions.length === 0) return 'No sessions. Use /session start <name>';

    const lines = ['## Sessions\n'];
    for (const s of sessions) {
      const status = s.status === 'active' ? '[active]' : s.status === 'paused' ? '[paused]' : `[${s.status}]`;
      lines.push(`${status} ${s.name ?? s.id.slice(0, 8)} -- started ${s.startedAt}`);
    }
    return lines.join('\n');
  }

  getProjectList(): string {
    const projects = this.projectRepo.findAll();
    if (projects.length === 0) return 'No projects registered. Use /project add <name> <path>';

    const lines = ['## Projects\n'];
    for (const p of projects) {
      const status = p.status === 'active' ? '[ok]' : p.status === 'paused' ? '[paused]' : '[archived]';
      lines.push(`${status} **${p.name}** -- ${p.path}`);
    }
    return lines.join('\n');
  }

  getProjectDetail(projectId: string): string {
    const project = this.projectRepo.findById(projectId);
    if (!project) return 'Project not found';

    const agents = this.agentService.getActiveAgents(projectId);
    const snapshot = this.taskQueue.getQueueSnapshot(projectId);

    return [
      `## ${project.name}`,
      `Path: ${project.path}`,
      `Status: ${project.status}`,
      `Tech Stack: ${project.config.techStack?.join(', ') ?? 'not set'}`,
      `LLM: ${project.config.defaultLLMProvider}`,
      '',
      `Agents: ${agents.length} active`,
      `Tasks: ${snapshot.pending} pending, ${snapshot.inProgress} in progress, ${snapshot.completed} completed`,
    ].join('\n');
  }

  getAgentList(projectId?: string): string {
    const agents = this.agentService.getActiveAgents(projectId);
    if (agents.length === 0) return 'No active agents. Use /spawn <role> to create one.';

    const lines = ['## Active Agents\n'];
    for (const agent of agents) {
      lines.push(`**${agent.definitionRole}** (${agent.id.substring(0, 8)}) [${agent.runtimeType}]`);
      lines.push(`  Status: ${agent.status} | Turns: ${agent.turnCount}`);
      if (agent.currentTaskId) {
        const task = this.taskService.findById(agent.currentTaskId);
        lines.push(`  Task: ${task?.title ?? agent.currentTaskId}`);
      }
      lines.push('');
    }
    return lines.join('\n');
  }
}

import type { ProjectRepository } from '@h/db';
import type { AgentService } from '@h/agents';
import type { TaskService, TaskQueue } from '@h/tasks';

export class StatusReporter {
  constructor(
    private projectRepo: ProjectRepository,
    private agentService: AgentService,
    private taskService: TaskService,
    private taskQueue: TaskQueue,
  ) {}

  getFullStatus(projectId?: string): string {
    const lines: string[] = ['## H Assistant Status\n'];

    // Current project
    if (projectId) {
      const project = this.projectRepo.findById(projectId);
      if (project) {
        lines.push(`**Project:** ${project.name}`);
        lines.push(`**Path:** ${project.path}`);
        lines.push('');
      }
    }

    // Agents
    const agents = this.agentService.getActiveAgents(projectId);
    lines.push(`**Agents:** ${agents.length} active`);
    for (const agent of agents) {
      const icon = agent.status === 'working' ? '⚡' : agent.status === 'idle' ? '💤' : '❌';
      lines.push(`  ${icon} ${agent.definitionRole} (${agent.id.substring(0, 8)}) — ${agent.status}`);
    }
    lines.push('');

    // Task queue
    const snapshot = this.taskQueue.getQueueSnapshot(projectId);
    lines.push('**Tasks:**');
    lines.push(`  Pending: ${snapshot.pending} | In Progress: ${snapshot.inProgress} | Review: ${snapshot.review}`);
    lines.push(`  Completed: ${snapshot.completed} | Failed: ${snapshot.failed} | Blocked: ${snapshot.blocked}`);

    return lines.join('\n');
  }

  getProjectList(): string {
    const projects = this.projectRepo.findAll();
    if (projects.length === 0) return 'No projects registered. Use /project add <name> <path>';

    const lines = ['## Projects\n'];
    for (const p of projects) {
      const status = p.status === 'active' ? '🟢' : p.status === 'paused' ? '🟡' : '⚫';
      lines.push(`${status} **${p.name}** — ${p.path}`);
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
      lines.push(`**${agent.definitionRole}** (${agent.id.substring(0, 8)})`);
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

import type { BlackboardEntry, BlackboardEntryType, BlackboardQuery, BlackboardScope } from '@h/types';
import type { EventBus } from '@h/events';
import { BlackboardRepository } from '@h/db';

export class BlackboardService {
  private repo: BlackboardRepository;

  constructor(private eventBus: EventBus) {
    this.repo = new BlackboardRepository();
  }

  post(entry: {
    projectId: string;
    sessionId?: string;
    agentId: string;
    taskId?: string;
    type: BlackboardEntryType;
    scope?: BlackboardScope;
    content: string;
    confidence?: number;
  }): BlackboardEntry {
    const result = this.repo.post({
      ...entry,
      scope: entry.scope ?? 'project',
      confidence: entry.confidence ?? 0.5,
    });

    this.eventBus.emit('blackboard.updated', {
      entryId: result.id,
      type: result.type,
      scope: result.scope,
      agentId: result.agentId,
      action: 'post',
    }, {
      source: 'blackboard-service',
      sessionId: entry.sessionId,
      projectId: entry.projectId,
      agentId: entry.agentId,
      taskId: entry.taskId,
    });

    return result;
  }

  query(q: BlackboardQuery): BlackboardEntry[] {
    return this.repo.query(q);
  }

  resolve(id: string, agentId: string): void {
    this.repo.resolve(id);
    this.eventBus.emit('blackboard.updated', {
      entryId: id,
      agentId,
      action: 'resolve',
    }, { source: 'blackboard-service' });
  }

  /**
   * Build a markdown context string from recent blackboard entries for an agent's prompt.
   * When sessionId is provided, includes both project-scoped and session-scoped entries.
   */
  buildContext(projectId: string, taskId?: string, sessionId?: string, limit = 20): string {
    // Get project-scoped entries
    const projectEntries = this.repo.query({
      projectId,
      taskId,
      scope: 'project',
      resolved: false,
      limit,
    });

    // Get session-scoped entries if sessionId provided
    let sessionEntries: BlackboardEntry[] = [];
    if (sessionId) {
      sessionEntries = this.repo.query({
        sessionId,
        scope: 'session',
        resolved: false,
        limit: Math.floor(limit / 2),
      });
    }

    const allEntries = [...sessionEntries, ...projectEntries].slice(0, limit);
    if (allEntries.length === 0) return '';

    const lines = allEntries.map(e => {
      const conf = Math.round(e.confidence * 100);
      const scopeTag = e.scope !== 'project' ? ` [${e.scope}]` : '';
      return `- [${e.type}]${scopeTag} (${conf}% confidence, by ${e.agentId.slice(0, 8)}) ${e.content}`;
    });

    return `## Shared Blackboard\n${lines.join('\n')}`;
  }

  queryBySession(sessionId: string, limit = 50): BlackboardEntry[] {
    return this.repo.query({ sessionId, scope: 'session', limit });
  }

  clear(projectId: string): number {
    return this.repo.deleteForProject(projectId);
  }
}

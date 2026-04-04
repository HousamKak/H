import type {
  Session, CreateSessionInput, SessionStatus,
  ProjectLink, CreateProjectLinkInput, Project,
} from '@h/types';
import type { EventBus } from '@h/events';
import { SessionRepository, ProjectRepository } from '@h/db';

export class SessionService {
  private sessionRepo: SessionRepository;
  private projectRepo: ProjectRepository;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.sessionRepo = new SessionRepository();
    this.projectRepo = new ProjectRepository();
    this.eventBus = eventBus;
  }

  async startSession(input: CreateSessionInput): Promise<Session> {
    const session = this.sessionRepo.create(input);

    // Add initial projects
    if (input.projectIds?.length) {
      for (let i = 0; i < input.projectIds.length; i++) {
        this.sessionRepo.addProject(session.id, input.projectIds[i], i === 0);
      }
    }

    await this.eventBus.emit('session.started', {
      sessionId: session.id,
      name: session.name,
      projectIds: input.projectIds ?? [],
    }, {
      source: 'session-service',
      sessionId: session.id,
    });

    return this.sessionRepo.findById(session.id)!;
  }

  async endSession(sessionId: string): Promise<void> {
    this.sessionRepo.endSession(sessionId);

    await this.eventBus.emit('session.completed', {
      sessionId,
    }, {
      source: 'session-service',
      sessionId,
    });
  }

  async addProject(sessionId: string, projectId: string, isPrimary = false): Promise<void> {
    this.sessionRepo.addProject(sessionId, projectId, isPrimary);

    await this.eventBus.emit('session.project.added', {
      sessionId,
      projectId,
      isPrimary,
    }, {
      source: 'session-service',
      sessionId,
      projectId,
    });
  }

  async removeProject(sessionId: string, projectId: string): Promise<void> {
    this.sessionRepo.removeProject(sessionId, projectId);

    await this.eventBus.emit('session.project.removed', {
      sessionId,
      projectId,
    }, {
      source: 'session-service',
      sessionId,
      projectId,
    });
  }

  /** Returns all sessions with status='active' (unlimited concurrent sessions). */
  getActiveSessions(): Session[] {
    return this.sessionRepo.findAllActive();
  }

  getSession(id: string): Session | undefined {
    return this.sessionRepo.findById(id);
  }

  getAllSessions(filter?: { status?: SessionStatus }): Session[] {
    return this.sessionRepo.findAll(filter);
  }

  getSessionProjects(sessionId: string): Project[] {
    const ids = this.sessionRepo.getProjectIds(sessionId);
    return ids.map(id => this.projectRepo.findById(id)).filter(Boolean) as Project[];
  }

  getSessionProjectIds(sessionId: string): string[] {
    return this.sessionRepo.getProjectIds(sessionId);
  }

  getPrimaryProjectId(sessionId: string): string | undefined {
    return this.sessionRepo.getPrimaryProjectId(sessionId);
  }

  // ---- Project Links ----

  async linkProjects(input: CreateProjectLinkInput): Promise<ProjectLink> {
    const existing = this.sessionRepo.findLink(input.sourceProjectId, input.targetProjectId);
    if (existing) return existing;

    const link = this.sessionRepo.createLink(input);

    await this.eventBus.emit('project.linked', {
      linkId: link.id,
      sourceProjectId: input.sourceProjectId,
      targetProjectId: input.targetProjectId,
      linkType: input.linkType,
    }, {
      source: 'session-service',
    });

    return link;
  }

  getLinkedProjects(projectId: string): Array<{ project: Project; link: ProjectLink }> {
    const links = this.sessionRepo.findLinks(projectId);
    return links.map(link => {
      const otherId = link.sourceProjectId === projectId ? link.targetProjectId : link.sourceProjectId;
      const project = this.projectRepo.findById(otherId);
      return project ? { project, link } : null;
    }).filter(Boolean) as Array<{ project: Project; link: ProjectLink }>;
  }

  unlinkProjects(linkId: string): boolean {
    return this.sessionRepo.deleteLink(linkId);
  }
}

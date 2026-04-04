import { getDatabase } from '../database.js';
import type { Session, CreateSessionInput, SessionStatus, SessionConfig, SessionSnapshot, ProjectLink, CreateProjectLinkInput } from '@h/types';
import { generateId } from '@h/types';

const DEFAULT_CONFIG: SessionConfig = { autoAssign: true, notifyOnCompletion: true };
const EMPTY_SNAPSHOT: SessionSnapshot = { activeAgentIds: [], pendingTaskIds: [], runningTerminalIds: [], blackboardSummary: '', lastActivity: '' };

function toSession(row: any): Session {
  return {
    id: row.id,
    name: row.name ?? undefined,
    status: row.status,
    startedAt: row.started_at,
    pausedAt: row.paused_at ?? undefined,
    resumedAt: row.resumed_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    focusDescription: row.focus_description ?? undefined,
    config: JSON.parse(row.config_json || '{}'),
    snapshot: JSON.parse(row.snapshot_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toLink(row: any): ProjectLink {
  return {
    id: row.id,
    sourceProjectId: row.source_project_id,
    targetProjectId: row.target_project_id,
    linkType: row.link_type,
    description: row.description ?? undefined,
    config: JSON.parse(row.config_json || '{}'),
    createdAt: row.created_at,
    updatedAt: row.created_at, // project_links has no updated_at
  };
}

export class SessionRepository {
  private get db() { return getDatabase(); }

  create(input: CreateSessionInput): Session {
    const id = generateId();
    const config = { ...DEFAULT_CONFIG, ...input.config };
    this.db.prepare(`
      INSERT INTO sessions (id, name, status, focus_description, config_json, snapshot_json)
      VALUES (?, ?, 'active', ?, ?, ?)
    `).run(id, input.name ?? null, input.focusDescription ?? null, JSON.stringify(config), JSON.stringify(EMPTY_SNAPSHOT));
    return this.findById(id)!;
  }

  findById(id: string): Session | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as any;
    return row ? toSession(row) : undefined;
  }

  findActive(): Session | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1").get() as any;
    return row ? toSession(row) : undefined;
  }

  findAll(filter?: { status?: SessionStatus }): Session[] {
    let sql = 'SELECT * FROM sessions WHERE 1=1';
    const params: any[] = [];
    if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
    sql += ' ORDER BY started_at DESC';
    return (this.db.prepare(sql).all(...params) as any[]).map(toSession);
  }

  updateStatus(id: string, status: SessionStatus, snapshot?: SessionSnapshot): void {
    const now = new Date().toISOString();
    const sets = ['status = ?', 'updated_at = ?'];
    const params: any[] = [status, now];

    if (status === 'paused') { sets.push('paused_at = ?'); params.push(now); }
    if (status === 'completed' || status === 'abandoned') { sets.push('completed_at = ?'); params.push(now); }
    if (snapshot) { sets.push('snapshot_json = ?'); params.push(JSON.stringify(snapshot)); }

    params.push(id);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  updateResumed(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`UPDATE sessions SET status = 'active', resumed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
  }

  update(id: string, changes: Partial<Pick<Session, 'name' | 'focusDescription' | 'config'>>): void {
    const sets: string[] = ['updated_at = ?'];
    const params: any[] = [new Date().toISOString()];
    if (changes.name !== undefined) { sets.push('name = ?'); params.push(changes.name); }
    if (changes.focusDescription !== undefined) { sets.push('focus_description = ?'); params.push(changes.focusDescription); }
    if (changes.config) { sets.push('config_json = ?'); params.push(JSON.stringify(changes.config)); }
    params.push(id);
    this.db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  // ---- Session-Project junction ----

  addProject(sessionId: string, projectId: string, isPrimary = false): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO session_projects (session_id, project_id, is_primary) VALUES (?, ?, ?)
    `).run(sessionId, projectId, isPrimary ? 1 : 0);
  }

  removeProject(sessionId: string, projectId: string): void {
    this.db.prepare('DELETE FROM session_projects WHERE session_id = ? AND project_id = ?').run(sessionId, projectId);
  }

  getProjectIds(sessionId: string): string[] {
    const rows = this.db.prepare('SELECT project_id FROM session_projects WHERE session_id = ? ORDER BY added_at').all(sessionId) as any[];
    return rows.map(r => r.project_id);
  }

  getPrimaryProjectId(sessionId: string): string | undefined {
    const row = this.db.prepare('SELECT project_id FROM session_projects WHERE session_id = ? AND is_primary = 1 LIMIT 1').get(sessionId) as any;
    return row?.project_id;
  }

  // ---- Project Links ----

  createLink(input: CreateProjectLinkInput): ProjectLink {
    const id = generateId();
    this.db.prepare(`
      INSERT INTO project_links (id, source_project_id, target_project_id, link_type, description)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, input.sourceProjectId, input.targetProjectId, input.linkType, input.description ?? null);
    return this.findLinkById(id)!;
  }

  findLinkById(id: string): ProjectLink | undefined {
    const row = this.db.prepare('SELECT * FROM project_links WHERE id = ?').get(id) as any;
    return row ? toLink(row) : undefined;
  }

  findLinks(projectId: string): ProjectLink[] {
    const rows = this.db.prepare(
      'SELECT * FROM project_links WHERE source_project_id = ? OR target_project_id = ? ORDER BY created_at'
    ).all(projectId, projectId) as any[];
    return rows.map(toLink);
  }

  findLink(sourceId: string, targetId: string): ProjectLink | undefined {
    const row = this.db.prepare(
      'SELECT * FROM project_links WHERE (source_project_id = ? AND target_project_id = ?) OR (source_project_id = ? AND target_project_id = ?)'
    ).get(sourceId, targetId, targetId, sourceId) as any;
    return row ? toLink(row) : undefined;
  }

  deleteLink(id: string): boolean {
    return this.db.prepare('DELETE FROM project_links WHERE id = ?').run(id).changes > 0;
  }
}

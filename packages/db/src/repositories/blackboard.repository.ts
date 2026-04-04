import { getDatabase } from '../database.js';
import type { BlackboardEntry, BlackboardQuery, BlackboardScope } from '@h/types';
import { generateId } from '@h/types';

export class BlackboardRepository {
  private get db() { return getDatabase(); }

  post(entry: Omit<BlackboardEntry, 'id' | 'createdAt' | 'resolved'>): BlackboardEntry {
    const id = generateId();
    const scope = entry.scope ?? 'project';
    this.db.prepare(`
      INSERT INTO blackboard_entries (id, project_id, session_id, agent_id, task_id, type, scope, content, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, entry.projectId, entry.sessionId ?? null, entry.agentId, entry.taskId ?? null, entry.type, scope, entry.content, entry.confidence);
    return { id, ...entry, scope, resolved: false, createdAt: new Date().toISOString() };
  }

  query(q: BlackboardQuery): BlackboardEntry[] {
    let sql = 'SELECT * FROM blackboard_entries WHERE 1=1';
    const params: any[] = [];

    if (q.projectId) { sql += ' AND project_id = ?'; params.push(q.projectId); }
    if (q.sessionId) { sql += ' AND (session_id = ? OR scope = ?)'; params.push(q.sessionId, 'session'); }
    if (q.scope) { sql += ' AND scope = ?'; params.push(q.scope); }
    if (q.types && q.types.length > 0) {
      sql += ` AND type IN (${q.types.map(() => '?').join(',')})`;
      params.push(...q.types);
    }
    if (q.taskId) { sql += ' AND task_id = ?'; params.push(q.taskId); }
    if (q.resolved !== undefined) { sql += ' AND resolved = ?'; params.push(q.resolved ? 1 : 0); }
    sql += ' ORDER BY created_at DESC';
    if (q.limit) { sql += ' LIMIT ?'; params.push(q.limit); }

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => ({
      id: row.id,
      projectId: row.project_id,
      sessionId: row.session_id ?? undefined,
      agentId: row.agent_id,
      taskId: row.task_id,
      type: row.type,
      scope: (row.scope ?? 'project') as BlackboardScope,
      content: row.content,
      confidence: row.confidence,
      resolved: !!row.resolved,
      createdAt: row.created_at,
    }));
  }

  resolve(id: string): void {
    this.db.prepare('UPDATE blackboard_entries SET resolved = 1 WHERE id = ?').run(id);
  }

  deleteForProject(projectId: string): number {
    const result = this.db.prepare('DELETE FROM blackboard_entries WHERE project_id = ?').run(projectId);
    return result.changes;
  }
}

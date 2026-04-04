import { getDatabase } from '../database.js';
import type { Terminal, SpawnTerminalInput, TerminalStatus } from '@h/types';
import { generateId } from '@h/types';

function toTerminal(row: any): Terminal {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    agentId: row.agent_id ?? undefined,
    name: row.name,
    type: row.type,
    status: row.status,
    pid: row.pid ?? undefined,
    command: row.command,
    args: JSON.parse(row.args_json || '[]'),
    cwd: row.cwd,
    env: JSON.parse(row.env_json || '{}'),
    exitCode: row.exit_code ?? undefined,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TerminalRepository {
  private get db() { return getDatabase(); }

  create(input: SpawnTerminalInput): Terminal {
    const id = generateId();
    this.db.prepare(`
      INSERT INTO terminals (id, session_id, project_id, agent_id, name, type, command, args_json, cwd, env_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.sessionId, input.projectId, input.agentId ?? null,
      input.name, input.type, input.command,
      JSON.stringify(input.args ?? []), input.cwd, JSON.stringify(input.env ?? {}),
    );
    return this.findById(id)!;
  }

  findById(id: string): Terminal | undefined {
    const row = this.db.prepare('SELECT * FROM terminals WHERE id = ?').get(id) as any;
    return row ? toTerminal(row) : undefined;
  }

  findBySession(sessionId: string, projectId?: string): Terminal[] {
    let sql = 'SELECT * FROM terminals WHERE session_id = ?';
    const params: any[] = [sessionId];
    if (projectId) { sql += ' AND project_id = ?'; params.push(projectId); }
    sql += ' ORDER BY started_at DESC';
    return (this.db.prepare(sql).all(...params) as any[]).map(toTerminal);
  }

  findByAgent(agentId: string): Terminal | undefined {
    const row = this.db.prepare('SELECT * FROM terminals WHERE agent_id = ?').get(agentId) as any;
    return row ? toTerminal(row) : undefined;
  }

  updateStatus(id: string, status: TerminalStatus, extra?: { pid?: number; exitCode?: number }): void {
    const now = new Date().toISOString();
    const sets = ['status = ?', 'updated_at = ?'];
    const params: any[] = [status, now];
    if (extra?.pid !== undefined) { sets.push('pid = ?'); params.push(extra.pid); }
    if (extra?.exitCode !== undefined) { sets.push('exit_code = ?'); params.push(extra.exitCode); }
    if (status === 'stopped' || status === 'crashed' || status === 'completed') {
      sets.push('stopped_at = ?'); params.push(now);
    }
    params.push(id);
    this.db.prepare(`UPDATE terminals SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  deleteBySession(sessionId: string): number {
    return this.db.prepare('DELETE FROM terminals WHERE session_id = ?').run(sessionId).changes;
  }
}

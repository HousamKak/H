import { getDatabase } from '../database.js';
import { generateId } from '@h/types';

export type A2APermissionStatus = 'pending' | 'granted' | 'denied' | 'revoked';

export interface A2APermission {
  id: string;
  fromSessionId: string;
  toSessionId: string;
  status: A2APermissionStatus;
  requestedByAgentId?: string;
  grantedAt?: string;
  createdAt: string;
}

function toPermission(row: any): A2APermission {
  return {
    id: row.id,
    fromSessionId: row.from_session_id,
    toSessionId: row.to_session_id,
    status: row.status,
    requestedByAgentId: row.requested_by_agent_id ?? undefined,
    grantedAt: row.granted_at ?? undefined,
    createdAt: row.created_at,
  };
}

export class A2APermissionsRepository {
  private get db() { return getDatabase(); }

  /** Check if fromSession can send to toSession. */
  canSend(fromSessionId: string, toSessionId: string): boolean {
    if (fromSessionId === toSessionId) return true;  // same session always ok
    const row = this.db.prepare(
      "SELECT status FROM session_a2a_permissions WHERE from_session_id = ? AND to_session_id = ? AND status = 'granted'"
    ).get(fromSessionId, toSessionId) as any;
    return !!row;
  }

  request(fromSessionId: string, toSessionId: string, requestedByAgentId?: string): A2APermission {
    const id = generateId();
    try {
      this.db.prepare(`
        INSERT INTO session_a2a_permissions (id, from_session_id, to_session_id, status, requested_by_agent_id)
        VALUES (?, ?, ?, 'pending', ?)
      `).run(id, fromSessionId, toSessionId, requestedByAgentId ?? null);
      return this.findByPair(fromSessionId, toSessionId)!;
    } catch {
      // Already exists — return existing
      return this.findByPair(fromSessionId, toSessionId)!;
    }
  }

  grant(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE session_a2a_permissions SET status = 'granted', granted_at = ? WHERE id = ?").run(now, id);
  }

  deny(id: string): void {
    this.db.prepare("UPDATE session_a2a_permissions SET status = 'denied' WHERE id = ?").run(id);
  }

  revoke(id: string): void {
    this.db.prepare("UPDATE session_a2a_permissions SET status = 'revoked' WHERE id = ?").run(id);
  }

  findByPair(fromSessionId: string, toSessionId: string): A2APermission | undefined {
    const row = this.db.prepare(
      'SELECT * FROM session_a2a_permissions WHERE from_session_id = ? AND to_session_id = ?'
    ).get(fromSessionId, toSessionId) as any;
    return row ? toPermission(row) : undefined;
  }

  findPending(toSessionId: string): A2APermission[] {
    const rows = this.db.prepare(
      "SELECT * FROM session_a2a_permissions WHERE to_session_id = ? AND status = 'pending' ORDER BY created_at DESC"
    ).all(toSessionId) as any[];
    return rows.map(toPermission);
  }

  findAll(filter?: { status?: A2APermissionStatus; sessionId?: string }): A2APermission[] {
    let sql = 'SELECT * FROM session_a2a_permissions WHERE 1=1';
    const params: any[] = [];
    if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
    if (filter?.sessionId) {
      sql += ' AND (from_session_id = ? OR to_session_id = ?)';
      params.push(filter.sessionId, filter.sessionId);
    }
    sql += ' ORDER BY created_at DESC';
    return (this.db.prepare(sql).all(...params) as any[]).map(toPermission);
  }
}

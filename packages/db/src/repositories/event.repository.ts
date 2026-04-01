import type { HEvent, EventType } from '@h/types';
import { getDatabase } from '../database.js';

export class EventRepository {
  insert(event: HEvent): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO events (id, type, timestamp, project_id, agent_id, task_id, payload_json, source, correlation_id, causation_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id, event.type, event.timestamp,
      event.projectId ?? null, event.agentId ?? null, event.taskId ?? null,
      JSON.stringify(event.payload), event.metadata.source,
      event.metadata.correlationId ?? null, event.metadata.causationId ?? null
    );
  }

  findAll(filter?: {
    types?: EventType[];
    projectId?: string;
    agentId?: string;
    taskId?: string;
    since?: string;
    limit?: number;
  }): HEvent[] {
    const db = getDatabase();
    let sql = 'SELECT * FROM events WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.types?.length) {
      sql += ` AND type IN (${filter.types.map(() => '?').join(',')})`;
      params.push(...filter.types);
    }
    if (filter?.projectId) { sql += ' AND project_id = ?'; params.push(filter.projectId); }
    if (filter?.agentId) { sql += ' AND agent_id = ?'; params.push(filter.agentId); }
    if (filter?.taskId) { sql += ' AND task_id = ?'; params.push(filter.taskId); }
    if (filter?.since) { sql += ' AND timestamp >= ?'; params.push(filter.since); }
    sql += ' ORDER BY timestamp DESC';
    if (filter?.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }

    return (db.prepare(sql).all(...params) as any[]).map(toEvent);
  }

  findByCorrelationId(correlationId: string): HEvent[] {
    const db = getDatabase();
    return (db.prepare('SELECT * FROM events WHERE correlation_id = ? ORDER BY timestamp ASC').all(correlationId) as any[]).map(toEvent);
  }

  count(filter?: { projectId?: string; since?: string }): number {
    const db = getDatabase();
    let sql = 'SELECT COUNT(*) as count FROM events WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.projectId) { sql += ' AND project_id = ?'; params.push(filter.projectId); }
    if (filter?.since) { sql += ' AND timestamp >= ?'; params.push(filter.since); }

    return (db.prepare(sql).get(...params) as any).count;
  }
}

function toEvent(row: any): HEvent {
  return {
    id: row.id,
    type: row.type,
    timestamp: row.timestamp,
    projectId: row.project_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    taskId: row.task_id ?? undefined,
    payload: JSON.parse(row.payload_json),
    metadata: {
      source: row.source,
      correlationId: row.correlation_id ?? undefined,
      causationId: row.causation_id ?? undefined,
    },
  };
}

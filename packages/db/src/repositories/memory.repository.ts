import type { MemoryRecord, StoreMemoryInput, RecallMemoryQuery } from '@h/types';
import { generateId } from '@h/types';
import { getDatabase } from '../database.js';

export class MemoryRepository {
  store(input: StoreMemoryInput): MemoryRecord {
    const db = getDatabase();
    const id = generateId();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO memory_records (id, project_id, agent_id, type, content, tags_json, importance, access_count, last_accessed_at, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
    `).run(
      id, input.projectId ?? null, input.agentId ?? null,
      input.type, input.content,
      JSON.stringify(input.tags ?? []),
      input.importance ?? 0.5,
      now, now, input.expiresAt ?? null
    );

    return this.findById(id)!;
  }

  findById(id: string): MemoryRecord | undefined {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM memory_records WHERE id = ?').get(id) as any;
    return row ? toMemory(row) : undefined;
  }

  recall(query: RecallMemoryQuery): MemoryRecord[] {
    const db = getDatabase();
    let sql = 'SELECT * FROM memory_records WHERE (expires_at IS NULL OR expires_at > datetime(\'now\'))';
    const params: unknown[] = [];

    if (query.projectId) {
      sql += ' AND (project_id = ? OR project_id IS NULL)';
      params.push(query.projectId);
    }
    if (query.agentId) { sql += ' AND (agent_id = ? OR agent_id IS NULL)'; params.push(query.agentId); }
    if (query.types?.length) {
      sql += ` AND type IN (${query.types.map(() => '?').join(',')})`;
      params.push(...query.types);
    }
    if (query.minImportance !== undefined) {
      sql += ' AND importance >= ?';
      params.push(query.minImportance);
    }

    sql += ' ORDER BY importance DESC, last_accessed_at DESC';
    if (query.limit) { sql += ' LIMIT ?'; params.push(query.limit); }

    const records = (db.prepare(sql).all(...params) as any[]).map(toMemory);

    // Tag filtering (post-query since tags are in JSON)
    if (query.tags?.length) {
      return records.filter((r) =>
        query.tags!.some((tag) => r.tags.includes(tag))
      );
    }

    return records;
  }

  incrementAccess(id: string): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE memory_records SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?
    `).run(id);
  }

  updateImportance(id: string, importance: number): void {
    const db = getDatabase();
    db.prepare('UPDATE memory_records SET importance = ? WHERE id = ?').run(importance, id);
  }

  forget(id: string): boolean {
    const db = getDatabase();
    return db.prepare('DELETE FROM memory_records WHERE id = ?').run(id).changes > 0;
  }

  decay(factor: number = 0.99): void {
    const db = getDatabase();
    db.prepare(`
      UPDATE memory_records
      SET importance = importance * ?
      WHERE expires_at IS NULL AND importance > 0.01
    `).run(factor);
  }

  cleanExpired(): number {
    const db = getDatabase();
    return db.prepare("DELETE FROM memory_records WHERE expires_at IS NOT NULL AND expires_at < datetime('now')").run().changes;
  }
}

function toMemory(row: any): MemoryRecord {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    type: row.type,
    content: row.content,
    tags: JSON.parse(row.tags_json),
    importance: row.importance,
    accessCount: row.access_count,
    lastAccessedAt: row.last_accessed_at,
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
  };
}

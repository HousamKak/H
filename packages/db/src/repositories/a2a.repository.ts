import { getDatabase } from '../database.js';
import type {
  AgentCard, RegisterAgentCardInput, AgentCardStatus, DiscoverAgentsFilter,
  A2AMessage, SendA2AMessageInput, A2AMessageStatus, A2AInboxFilter,
} from '@h/types';
import { generateId } from '@h/types';

function toCard(row: any): AgentCard {
  return {
    agentId: row.agent_id,
    name: row.name,
    description: row.description,
    projectId: row.project_id,
    sessionId: row.session_id,
    capabilities: JSON.parse(row.capabilities_json || '[]'),
    skills: JSON.parse(row.skills_json || '[]'),
    endpoint: row.endpoint,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: any): A2AMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    fromAgentId: row.from_agent_id,
    toAgentId: row.to_agent_id ?? undefined,
    fromProjectId: row.from_project_id,
    toProjectId: row.to_project_id ?? undefined,
    type: row.type,
    subject: row.subject ?? undefined,
    body: row.body,
    artifacts: JSON.parse(row.artifacts_json || '[]'),
    correlationId: row.correlation_id ?? undefined,
    inReplyTo: row.in_reply_to ?? undefined,
    priority: row.priority,
    status: row.status,
    createdAt: row.created_at,
    deliveredAt: row.delivered_at ?? undefined,
    processedAt: row.processed_at ?? undefined,
  };
}

export class A2ARepository {
  private get db() { return getDatabase(); }

  // ---- Agent Cards ----

  upsertCard(input: RegisterAgentCardInput): AgentCard {
    this.db.prepare(`
      INSERT INTO agent_cards (agent_id, name, description, project_id, session_id, capabilities_json, skills_json, endpoint, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available')
      ON CONFLICT(agent_id) DO UPDATE SET
        name = excluded.name, description = excluded.description,
        capabilities_json = excluded.capabilities_json, skills_json = excluded.skills_json,
        endpoint = excluded.endpoint, status = 'available', updated_at = datetime('now')
    `).run(
      input.agentId, input.name, input.description, input.projectId, input.sessionId,
      JSON.stringify(input.capabilities), JSON.stringify(input.skills ?? []),
      input.endpoint ?? '',
    );
    return this.findCard(input.agentId)!;
  }

  findCard(agentId: string): AgentCard | undefined {
    const row = this.db.prepare('SELECT * FROM agent_cards WHERE agent_id = ?').get(agentId) as any;
    return row ? toCard(row) : undefined;
  }

  discover(filter: DiscoverAgentsFilter): AgentCard[] {
    let sql = 'SELECT * FROM agent_cards WHERE session_id = ?';
    const params: any[] = [filter.sessionId];
    if (filter.projectId) { sql += ' AND project_id = ?'; params.push(filter.projectId); }
    if (filter.status) { sql += ' AND status = ?'; params.push(filter.status); }
    sql += ' ORDER BY updated_at DESC';
    let cards = (this.db.prepare(sql).all(...params) as any[]).map(toCard);
    if (filter.capability) {
      cards = cards.filter(c => c.capabilities.includes(filter.capability!));
    }
    return cards;
  }

  updateCardStatus(agentId: string, status: AgentCardStatus): void {
    this.db.prepare("UPDATE agent_cards SET status = ?, updated_at = datetime('now') WHERE agent_id = ?").run(status, agentId);
  }

  deleteCard(agentId: string): boolean {
    return this.db.prepare('DELETE FROM agent_cards WHERE agent_id = ?').run(agentId).changes > 0;
  }

  // ---- A2A Messages ----

  createMessage(sessionId: string, fromAgentId: string, fromProjectId: string, input: SendA2AMessageInput): A2AMessage {
    const id = generateId();
    this.db.prepare(`
      INSERT INTO a2a_messages (id, session_id, from_agent_id, to_agent_id, from_project_id, to_project_id,
        type, subject, body, artifacts_json, correlation_id, in_reply_to, priority)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, sessionId, fromAgentId, input.toAgentId ?? null, fromProjectId, input.toProjectId ?? null,
      input.type, input.subject ?? null, input.body, JSON.stringify(input.artifacts ?? []),
      input.correlationId ?? null, input.inReplyTo ?? null, input.priority ?? 'normal',
    );
    return this.findMessage(id)!;
  }

  findMessage(id: string): A2AMessage | undefined {
    const row = this.db.prepare('SELECT * FROM a2a_messages WHERE id = ?').get(id) as any;
    return row ? toMessage(row) : undefined;
  }

  getInbox(agentId: string, filter?: A2AInboxFilter): A2AMessage[] {
    let sql = 'SELECT * FROM a2a_messages WHERE (to_agent_id = ? OR to_agent_id IS NULL)';
    const params: any[] = [agentId];
    if (filter?.unreadOnly) { sql += " AND status IN ('pending', 'delivered')"; }
    if (filter?.type) { sql += ' AND type = ?'; params.push(filter.type); }
    if (filter?.fromAgentId) { sql += ' AND from_agent_id = ?'; params.push(filter.fromAgentId); }
    sql += ' ORDER BY created_at DESC';
    if (filter?.limit) { sql += ' LIMIT ?'; params.push(filter.limit); }
    return (this.db.prepare(sql).all(...params) as any[]).map(toMessage);
  }

  getOutbox(agentId: string, limit = 50): A2AMessage[] {
    return (this.db.prepare(
      'SELECT * FROM a2a_messages WHERE from_agent_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(agentId, limit) as any[]).map(toMessage);
  }

  findByCorrelation(correlationId: string): A2AMessage[] {
    return (this.db.prepare(
      'SELECT * FROM a2a_messages WHERE correlation_id = ? ORDER BY created_at'
    ).all(correlationId) as any[]).map(toMessage);
  }

  updateStatus(id: string, status: A2AMessageStatus): void {
    const now = new Date().toISOString();
    const extra = status === 'delivered' ? ', delivered_at = ?' :
                  status === 'processed' ? ', processed_at = ?' : '';
    const params: any[] = [status];
    if (extra) params.push(now);
    params.push(id);
    this.db.prepare(`UPDATE a2a_messages SET status = ?${extra} WHERE id = ?`).run(...params);
  }

  countPending(agentId: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) as cnt FROM a2a_messages WHERE (to_agent_id = ? OR to_agent_id IS NULL) AND status = 'pending'"
    ).get(agentId) as any;
    return row?.cnt ?? 0;
  }
}

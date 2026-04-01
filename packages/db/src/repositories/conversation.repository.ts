import type { Conversation, Message, InterfaceSource, MessageRole } from '@h/types';
import { generateId } from '@h/types';
import { getDatabase } from '../database.js';

export class ConversationRepository {
  createConversation(input: { projectId?: string; agentId?: string; taskId?: string; interfaceSource: InterfaceSource }): Conversation {
    const db = getDatabase();
    const id = generateId();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO conversations (id, project_id, agent_id, task_id, interface_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.projectId ?? null, input.agentId ?? null, input.taskId ?? null, input.interfaceSource, now, now);

    return { id, ...input, createdAt: now, updatedAt: now } as Conversation;
  }

  findConversation(id: string): Conversation | undefined {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) as any;
    return row ? toConversation(row) : undefined;
  }

  addMessage(input: {
    conversationId: string;
    role: MessageRole;
    content: string;
    agentId?: string;
    toolCalls?: unknown[];
    toolResults?: unknown[];
    tokenCount?: number;
  }): Message {
    const db = getDatabase();
    const id = generateId();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO messages (id, conversation_id, role, agent_id, content, tool_calls_json, tool_results_json, token_count, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, input.conversationId, input.role, input.agentId ?? null,
      input.content,
      input.toolCalls ? JSON.stringify(input.toolCalls) : null,
      input.toolResults ? JSON.stringify(input.toolResults) : null,
      input.tokenCount ?? null, now
    );

    // Update conversation timestamp
    db.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now, input.conversationId);

    return {
      id,
      conversationId: input.conversationId,
      role: input.role,
      agentId: input.agentId,
      content: input.content,
      toolCalls: input.toolCalls as any,
      toolResults: input.toolResults as any,
      tokenCount: input.tokenCount,
      timestamp: now,
    };
  }

  getMessages(conversationId: string, limit?: number): Message[] {
    const db = getDatabase();
    let sql = 'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC';
    const params: unknown[] = [conversationId];
    if (limit) { sql += ' LIMIT ?'; params.push(limit); }
    return (db.prepare(sql).all(...params) as any[]).map(toMessage);
  }
}

function toConversation(row: any): Conversation {
  return {
    id: row.id,
    projectId: row.project_id ?? undefined,
    agentId: row.agent_id ?? undefined,
    taskId: row.task_id ?? undefined,
    interfaceSource: row.interface_source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: any): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    agentId: row.agent_id ?? undefined,
    content: row.content,
    toolCalls: row.tool_calls_json ? JSON.parse(row.tool_calls_json) : undefined,
    toolResults: row.tool_results_json ? JSON.parse(row.tool_results_json) : undefined,
    tokenCount: row.token_count ?? undefined,
    timestamp: row.timestamp,
  };
}

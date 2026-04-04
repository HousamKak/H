import { getDatabase } from '../database.js';
import type { AgentCheckpoint, ContextAnchor } from '@h/types';
import { generateId } from '@h/types';

export class CheckpointRepository {
  private get db() { return getDatabase(); }

  save(checkpoint: Omit<AgentCheckpoint, 'id'>): AgentCheckpoint {
    const id = generateId();
    this.db.prepare(`
      INSERT INTO agent_checkpoints (id, agent_id, task_id, timestamp, turn_count, context_anchor_json, recent_messages_json, token_usage_json, git_ref)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?)
    `).run(
      id,
      checkpoint.agentId,
      checkpoint.taskId,
      checkpoint.turnCount,
      JSON.stringify(checkpoint.contextAnchor),
      JSON.stringify(checkpoint.recentMessages),
      JSON.stringify(checkpoint.tokenUsage),
      checkpoint.gitRef ?? null
    );
    return { id, ...checkpoint, timestamp: new Date().toISOString() };
  }

  findLatest(agentId: string, taskId: string): AgentCheckpoint | undefined {
    const row = this.db.prepare(`
      SELECT * FROM agent_checkpoints WHERE agent_id = ? AND task_id = ? ORDER BY timestamp DESC LIMIT 1
    `).get(agentId, taskId) as any;
    if (!row) return undefined;
    return {
      id: row.id,
      agentId: row.agent_id,
      taskId: row.task_id,
      timestamp: row.timestamp,
      turnCount: row.turn_count,
      contextAnchor: JSON.parse(row.context_anchor_json),
      recentMessages: JSON.parse(row.recent_messages_json),
      tokenUsage: JSON.parse(row.token_usage_json),
      gitRef: row.git_ref,
    };
  }

  findByAgent(agentId: string): AgentCheckpoint[] {
    const rows = this.db.prepare(`
      SELECT * FROM agent_checkpoints WHERE agent_id = ? ORDER BY timestamp DESC
    `).all(agentId) as any[];
    return rows.map(row => ({
      id: row.id,
      agentId: row.agent_id,
      taskId: row.task_id,
      timestamp: row.timestamp,
      turnCount: row.turn_count,
      contextAnchor: JSON.parse(row.context_anchor_json),
      recentMessages: JSON.parse(row.recent_messages_json),
      tokenUsage: JSON.parse(row.token_usage_json),
      gitRef: row.git_ref,
    }));
  }

  deleteForAgent(agentId: string): number {
    const result = this.db.prepare('DELETE FROM agent_checkpoints WHERE agent_id = ?').run(agentId);
    return result.changes;
  }
}

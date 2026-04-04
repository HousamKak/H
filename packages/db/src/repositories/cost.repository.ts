import { getDatabase } from '../database.js';
import type { CostRecord } from '@h/types';
import { generateId } from '@h/types';

export class CostRepository {
  private get db() { return getDatabase(); }

  record(cost: Omit<CostRecord, 'id' | 'timestamp'>): CostRecord {
    const id = generateId();
    this.db.prepare(`
      INSERT INTO cost_records (id, trace_id, agent_id, task_id, project_id, provider, model, input_tokens, output_tokens, cost_usd)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, cost.traceId ?? null, cost.agentId ?? null, cost.taskId ?? null,
      cost.projectId ?? null, cost.provider, cost.model,
      cost.inputTokens, cost.outputTokens, cost.costUsd
    );
    return { id, ...cost, timestamp: new Date().toISOString() };
  }

  totalForTask(taskId: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_records WHERE task_id = ?').get(taskId) as any;
    return row.total;
  }

  totalForAgent(agentId: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_records WHERE agent_id = ?').get(agentId) as any;
    return row.total;
  }

  totalForProject(projectId: string): number {
    const row = this.db.prepare('SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_records WHERE project_id = ?').get(projectId) as any;
    return row.total;
  }

  dailyTotal(projectId?: string): number {
    let sql = "SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_records WHERE timestamp >= date('now')";
    const params: any[] = [];
    if (projectId) {
      sql += ' AND project_id = ?';
      params.push(projectId);
    }
    const row = this.db.prepare(sql).get(...params) as any;
    return row.total;
  }

  findByProject(projectId: string, limit = 100): CostRecord[] {
    const rows = this.db.prepare('SELECT * FROM cost_records WHERE project_id = ? ORDER BY timestamp DESC LIMIT ?').all(projectId, limit) as any[];
    return rows.map(row => ({
      id: row.id,
      traceId: row.trace_id,
      agentId: row.agent_id,
      taskId: row.task_id,
      projectId: row.project_id,
      provider: row.provider,
      model: row.model,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
      timestamp: row.timestamp,
    }));
  }
}

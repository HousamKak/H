import { getDatabase } from '../database.js';
import type { TraceSpan } from '@h/types';
import { generateId } from '@h/types';

export class TraceRepository {
  private get db() { return getDatabase(); }

  startSpan(span: Omit<TraceSpan, 'id' | 'startTime' | 'status'>): TraceSpan {
    const id = generateId();
    const startTime = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO trace_spans (id, trace_id, parent_span_id, agent_id, task_id, operation, start_time, status, model, tool_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ok', ?, ?)
    `).run(
      id, span.traceId, span.parentSpanId ?? null, span.agentId ?? null,
      span.taskId ?? null, span.operation, startTime, span.model ?? null, span.toolName ?? null
    );
    return { id, ...span, startTime, status: 'ok' };
  }

  endSpan(id: string, result: { status?: 'ok' | 'error'; inputTokens?: number; outputTokens?: number; costUsd?: number; errorMessage?: string }): void {
    this.db.prepare(`
      UPDATE trace_spans SET end_time = datetime('now'), status = ?, input_tokens = ?, output_tokens = ?, cost_usd = ?, error_message = ?
      WHERE id = ?
    `).run(result.status ?? 'ok', result.inputTokens ?? null, result.outputTokens ?? null, result.costUsd ?? null, result.errorMessage ?? null, id);
  }

  findByTrace(traceId: string): TraceSpan[] {
    const rows = this.db.prepare('SELECT * FROM trace_spans WHERE trace_id = ? ORDER BY start_time ASC').all(traceId) as any[];
    return rows.map(this.mapRow);
  }

  findByAgent(agentId: string, limit = 50): TraceSpan[] {
    const rows = this.db.prepare('SELECT * FROM trace_spans WHERE agent_id = ? ORDER BY start_time DESC LIMIT ?').all(agentId, limit) as any[];
    return rows.map(this.mapRow);
  }

  findByTask(taskId: string): TraceSpan[] {
    const rows = this.db.prepare('SELECT * FROM trace_spans WHERE task_id = ? ORDER BY start_time ASC').all(taskId) as any[];
    return rows.map(this.mapRow);
  }

  private mapRow(row: any): TraceSpan {
    return {
      id: row.id,
      traceId: row.trace_id,
      parentSpanId: row.parent_span_id,
      agentId: row.agent_id,
      taskId: row.task_id,
      operation: row.operation,
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      costUsd: row.cost_usd,
      model: row.model,
      toolName: row.tool_name,
      errorMessage: row.error_message,
    };
  }
}

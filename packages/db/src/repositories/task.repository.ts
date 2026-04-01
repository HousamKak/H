import type { Task, CreateTaskInput, TaskStatus, TaskResult } from '@h/types';
import { generateId } from '@h/types';
import { getDatabase } from '../database.js';

export class TaskRepository {
  findAll(filter?: { projectId?: string; status?: TaskStatus; assignedAgentId?: string; parentTaskId?: string }): Task[] {
    const db = getDatabase();
    let sql = 'SELECT * FROM tasks WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.projectId) { sql += ' AND project_id = ?'; params.push(filter.projectId); }
    if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
    if (filter?.assignedAgentId) { sql += ' AND assigned_agent_id = ?'; params.push(filter.assignedAgentId); }
    if (filter?.parentTaskId) { sql += ' AND parent_task_id = ?'; params.push(filter.parentTaskId); }
    sql += ' ORDER BY CASE priority WHEN \'critical\' THEN 0 WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 WHEN \'low\' THEN 3 END, created_at ASC';

    return (db.prepare(sql).all(...params) as any[]).map(toTask);
  }

  findById(id: string): Task | undefined {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    return row ? toTask(row) : undefined;
  }

  findPendingWithSatisfiedDependencies(): Task[] {
    const db = getDatabase();
    const pending = this.findAll({ status: 'pending' });
    return pending.filter((task) => {
      if (task.dependencies.length === 0) return true;
      return task.dependencies.every((depId) => {
        const dep = this.findById(depId);
        return dep?.status === 'completed';
      });
    });
  }

  create(input: CreateTaskInput): Task {
    const db = getDatabase();
    const id = generateId();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO tasks (id, project_id, parent_task_id, title, description, status, priority, required_role, dependencies_json, subtasks_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, '[]', ?, ?)
    `).run(
      id, input.projectId, input.parentTaskId ?? null,
      input.title, input.description,
      input.priority ?? 'medium', input.requiredRole ?? 'coder',
      JSON.stringify(input.dependencies ?? []),
      now, now
    );

    // If this is a subtask, add it to parent's subtasks array
    if (input.parentTaskId) {
      const parent = this.findById(input.parentTaskId);
      if (parent) {
        const subtasks = [...parent.subtasks, id];
        db.prepare('UPDATE tasks SET subtasks_json = ?, updated_at = ? WHERE id = ?')
          .run(JSON.stringify(subtasks), now, input.parentTaskId);
      }
    }

    return this.findById(id)!;
  }

  updateStatus(id: string, status: TaskStatus, extra?: { assignedAgentId?: string | null; result?: TaskResult }): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    const sets = ['status = ?', 'updated_at = ?'];
    const params: unknown[] = [status, now];

    if (extra?.assignedAgentId !== undefined) { sets.push('assigned_agent_id = ?'); params.push(extra.assignedAgentId); }
    if (extra?.result !== undefined) { sets.push('result_json = ?'); params.push(JSON.stringify(extra.result)); }
    if (status === 'in_progress' || status === 'assigned') { sets.push('started_at = COALESCE(started_at, ?)'); params.push(now); }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') { sets.push('completed_at = ?'); params.push(now); }

    params.push(id);
    db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  delete(id: string): boolean {
    const db = getDatabase();
    return db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  }
}

function toTask(row: any): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    parentTaskId: row.parent_task_id ?? undefined,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    requiredRole: row.required_role,
    assignedAgentId: row.assigned_agent_id ?? undefined,
    dependencies: JSON.parse(row.dependencies_json),
    subtasks: JSON.parse(row.subtasks_json),
    result: row.result_json ? JSON.parse(row.result_json) : undefined,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

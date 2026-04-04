import type { TaskGraph, TaskGraphNode } from '@h/types';
import { generateId } from '@h/types';
import { getDatabase } from '../database.js';

export class TaskGraphRepository {
  create(input: Omit<TaskGraph, 'id' | 'createdAt'>): TaskGraph {
    const db = getDatabase();
    const id = generateId();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO task_graphs (id, project_id, root_task_id, nodes_json, strategy, status, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.projectId,
      input.rootTaskId,
      JSON.stringify(input.nodes),
      input.strategy,
      input.status,
      now,
      input.completedAt ?? null,
    );

    return this.findById(id)!;
  }

  findById(id: string): TaskGraph | undefined {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM task_graphs WHERE id = ?').get(id) as any;
    return row ? toTaskGraph(row) : undefined;
  }

  findByProject(projectId: string): TaskGraph[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM task_graphs WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[];
    return rows.map(toTaskGraph);
  }

  updateStatus(id: string, status: string): void {
    const db = getDatabase();
    const sets = ['status = ?'];
    const params: unknown[] = [status];

    if (status === 'completed' || status === 'failed') {
      sets.push('completed_at = ?');
      params.push(new Date().toISOString());
    }

    params.push(id);
    db.prepare(`UPDATE task_graphs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  updateNodes(id: string, nodes: TaskGraphNode[]): void {
    const db = getDatabase();
    db.prepare('UPDATE task_graphs SET nodes_json = ? WHERE id = ?')
      .run(JSON.stringify(nodes), id);
  }
}

function toTaskGraph(row: any): TaskGraph {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id ?? undefined,
    rootTaskId: row.root_task_id,
    nodes: JSON.parse(row.nodes_json),
    strategy: row.strategy,
    status: row.status,
    isCrossProject: !!(row.is_cross_project),
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
  };
}

import type { Project, CreateProjectInput, ProjectConfig } from '@h/types';
import { generateId } from '@h/types';
import { getDatabase } from '../database.js';

export class ProjectRepository {
  findAll(): Project[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all() as any[];
    return rows.map(toProject);
  }

  findById(id: string): Project | undefined {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    return row ? toProject(row) : undefined;
  }

  findByName(name: string): Project | undefined {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as any;
    return row ? toProject(row) : undefined;
  }

  create(input: CreateProjectInput): Project {
    const db = getDatabase();
    const id = generateId();
    const now = new Date().toISOString();
    const config: ProjectConfig = {
      defaultLLMProvider: input.config?.defaultLLMProvider ?? 'claude',
      memoryNamespace: input.config?.memoryNamespace ?? input.name.toLowerCase().replace(/\s+/g, '-'),
      ...input.config,
    };

    db.prepare(`
      INSERT INTO projects (id, name, path, description, status, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, input.name, input.path, input.description ?? null, JSON.stringify(config), now, now);

    return this.findById(id)!;
  }

  update(id: string, changes: Partial<Pick<Project, 'name' | 'path' | 'description' | 'status' | 'config'>>): Project | undefined {
    const db = getDatabase();
    const existing = this.findById(id);
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const sets: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];

    if (changes.name !== undefined) { sets.push('name = ?'); values.push(changes.name); }
    if (changes.path !== undefined) { sets.push('path = ?'); values.push(changes.path); }
    if (changes.description !== undefined) { sets.push('description = ?'); values.push(changes.description); }
    if (changes.status !== undefined) { sets.push('status = ?'); values.push(changes.status); }
    if (changes.config !== undefined) { sets.push('config_json = ?'); values.push(JSON.stringify(changes.config)); }

    values.push(id);
    db.prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return this.findById(id);
  }

  delete(id: string): boolean {
    const db = getDatabase();
    const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
  }
}

function toProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    description: row.description ?? undefined,
    status: row.status,
    config: JSON.parse(row.config_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

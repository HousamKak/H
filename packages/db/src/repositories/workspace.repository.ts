import { getDatabase } from '../database.js';
import type { Workspace, UpdateWorkspaceInput, Applet, CanvasViewport } from '@h/types';

function toWorkspace(row: any): Workspace {
  return {
    id: row.id,
    layout: row.layout_json && row.layout_json !== '{}' ? JSON.parse(row.layout_json) as CanvasViewport : null,
    applets: JSON.parse(row.applets_json || '[]') as Applet[],
    updatedAt: row.updated_at,
  };
}

export class WorkspaceRepository {
  private get db() { return getDatabase(); }

  get(id: string = 'default'): Workspace {
    const row = this.db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any;
    if (!row) {
      this.db.prepare("INSERT INTO workspaces (id, layout_json, applets_json) VALUES (?, '{}', '[]')").run(id);
      return this.get(id);
    }
    return toWorkspace(row);
  }

  update(id: string, input: UpdateWorkspaceInput): Workspace {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO workspaces (id, layout_json, applets_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        layout_json = excluded.layout_json,
        applets_json = excluded.applets_json,
        updated_at = excluded.updated_at
    `).run(id, JSON.stringify(input.layout ?? {}), JSON.stringify(input.applets), now);
    return this.get(id);
  }

  reset(id: string = 'default'): void {
    this.db.prepare("UPDATE workspaces SET layout_json = '{}', applets_json = '[]' WHERE id = ?").run(id);
  }
}

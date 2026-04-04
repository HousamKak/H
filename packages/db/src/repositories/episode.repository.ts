import { getDatabase } from '../database.js';
import type { Episode } from '@h/types';
import { generateId } from '@h/types';

export class EpisodeRepository {
  private get db() { return getDatabase(); }

  record(episode: Omit<Episode, 'id' | 'createdAt'>): Episode {
    const id = generateId();
    this.db.prepare(`
      INSERT INTO episodes (id, project_id, task_type, summary, outcome, lessons_json, files_json, token_cost, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, episode.projectId, episode.taskType, episode.summary, episode.outcome,
      JSON.stringify(episode.lessonsLearned), JSON.stringify(episode.filesInvolved),
      episode.tokenCost, episode.durationMs
    );
    return { id, ...episode, createdAt: new Date().toISOString() };
  }

  findSimilar(projectId: string, taskType: string, limit = 5): Episode[] {
    const rows = this.db.prepare(`
      SELECT * FROM episodes WHERE project_id = ? AND task_type = ? ORDER BY created_at DESC LIMIT ?
    `).all(projectId, taskType, limit) as any[];
    return rows.map(this.mapRow);
  }

  findByProject(projectId: string, limit = 20): Episode[] {
    const rows = this.db.prepare(`
      SELECT * FROM episodes WHERE project_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(projectId, limit) as any[];
    return rows.map(this.mapRow);
  }

  findByOutcome(projectId: string, outcome: string, limit = 10): Episode[] {
    const rows = this.db.prepare(`
      SELECT * FROM episodes WHERE project_id = ? AND outcome = ? ORDER BY created_at DESC LIMIT ?
    `).all(projectId, outcome, limit) as any[];
    return rows.map(this.mapRow);
  }

  private mapRow(row: any): Episode {
    return {
      id: row.id,
      projectId: row.project_id,
      taskType: row.task_type,
      summary: row.summary,
      outcome: row.outcome,
      lessonsLearned: JSON.parse(row.lessons_json),
      filesInvolved: JSON.parse(row.files_json),
      tokenCost: row.token_cost,
      durationMs: row.duration_ms,
      createdAt: row.created_at,
    };
  }
}

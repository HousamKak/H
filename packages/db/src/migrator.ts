import type Database from 'better-sqlite3';
import { getDatabase } from './database.js';

interface ColumnInfo {
  name: string;
  type: string;
}

export class Migrator {
  private db: Database.Database;

  constructor(db?: Database.Database) {
    this.db = db ?? getDatabase();
  }

  run(): void {
    this.ensureMigrationsTable();
    this.applyColumnMigrations();
  }

  private ensureMigrationsTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  private hasColumn(table: string, column: string): boolean {
    const columns = this.db.prepare(`PRAGMA table_info("${table}")`).all() as ColumnInfo[];
    return columns.some(c => c.name === column);
  }

  private hasMigration(name: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(name);
    return !!row;
  }

  private recordMigration(name: string): void {
    this.db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
  }

  private addColumnIfMissing(table: string, column: string, definition: string, migrationName: string): void {
    if (!this.hasColumn(table, column)) {
      this.db.exec(`ALTER TABLE "${table}" ADD COLUMN ${column} ${definition}`);
    }
    if (!this.hasMigration(migrationName)) {
      this.recordMigration(migrationName);
    }
  }

  private applyColumnMigrations(): void {
    // 001: Session and multi-project support
    this.addColumnIfMissing('blackboard_entries', 'scope',
      "TEXT NOT NULL DEFAULT 'project'", '001_blackboard_scope');
    this.addColumnIfMissing('blackboard_entries', 'session_id',
      'TEXT', '001_blackboard_session_id');

    this.addColumnIfMissing('agent_instances', 'session_id',
      'TEXT', '001_agent_session_id');
    this.addColumnIfMissing('agent_instances', 'runtime_type',
      "TEXT NOT NULL DEFAULT 'internal'", '001_agent_runtime_type');
    this.addColumnIfMissing('agent_instances', 'terminal_id',
      'TEXT', '001_agent_terminal_id');
    this.addColumnIfMissing('agent_instances', 'mcp_config_path',
      'TEXT', '001_agent_mcp_config_path');

    this.addColumnIfMissing('task_graphs', 'session_id',
      'TEXT', '001_task_graph_session_id');
    this.addColumnIfMissing('task_graphs', 'is_cross_project',
      'INTEGER NOT NULL DEFAULT 0', '001_task_graph_cross_project');

    this.addColumnIfMissing('tasks', 'session_id',
      'TEXT', '001_task_session_id');

    this.addColumnIfMissing('events', 'session_id',
      'TEXT', '001_event_session_id');
  }
}

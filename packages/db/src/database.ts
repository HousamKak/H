import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (db) return db;

  const path = dbPath ?? process.env.H_DB_PATH ?? './data/h.db';
  db = new Database(path);

  // Apply schema
  const schema = readFileSync(join(__dirname, '..', 'src', 'schema.sql'), 'utf-8');
  db.exec(schema);

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function resetDatabase(): void {
  if (!db) return;
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  db.exec('PRAGMA foreign_keys = OFF');
  for (const { name } of tables) {
    db.exec(`DELETE FROM "${name}"`);
  }
  db.exec('PRAGMA foreign_keys = ON');
}

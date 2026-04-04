import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Migrator } from './migrator.js';

// In source/tsc output this is the dist dir; in bundled output import.meta.url
// may be undefined (CJS bundle) — we fall back to env vars then cwd.
function moduleDir(): string | undefined {
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return undefined;
  }
}

function findSchemaPath(): string {
  // 1. Explicit env var (used by bundled/desktop build)
  if (process.env.H_SCHEMA_PATH && existsSync(process.env.H_SCHEMA_PATH)) {
    return process.env.H_SCHEMA_PATH;
  }
  // 2. Relative to this module's location (tsc output in dist/ → src/schema.sql)
  const srcDir = moduleDir();
  if (srcDir) {
    const devPath = join(srcDir, '..', 'src', 'schema.sql');
    if (existsSync(devPath)) return devPath;
  }
  // 3. Adjacent to process cwd (bundled backend copies schema.sql to its own dir)
  const cwdPath = join(process.cwd(), 'schema.sql');
  if (existsSync(cwdPath)) return cwdPath;
  // 4. Last resort
  throw new Error('Could not locate schema.sql. Set H_SCHEMA_PATH env var.');
}

let db: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (db) return db;

  const path = dbPath ?? process.env.H_DB_PATH ?? './data/h.db';
  db = new Database(path);

  // Apply schema
  const schema = readFileSync(findSchemaPath(), 'utf-8');
  db.exec(schema);

  // Run migrations (ALTER TABLE for existing DBs)
  const migrator = new Migrator(db);
  migrator.run();

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

#!/usr/bin/env node
/**
 * Bundles the H backend (CLI + all @h/* packages) into a single JS file
 * that can be shipped inside the Tauri app.
 *
 * Output: packages/desktop/src-tauri/resources/backend/h-backend.js
 *
 * Externals: better-sqlite3 (native module — shipped separately)
 */

import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DESKTOP_ROOT = resolve(__dirname, '..');
const REPO_ROOT = resolve(DESKTOP_ROOT, '..', '..');
const BACKEND_OUT_DIR = join(DESKTOP_ROOT, 'src-tauri', 'resources', 'backend');
const OUT_FILE = join(BACKEND_OUT_DIR, 'h-backend.cjs');

console.log('[bundle] Bundling H backend...');
console.log(`[bundle] Output: ${OUT_FILE}`);

// Clean output dir
if (existsSync(BACKEND_OUT_DIR)) {
  await rm(BACKEND_OUT_DIR, { recursive: true, force: true });
}
await mkdir(BACKEND_OUT_DIR, { recursive: true });

// Bundle with esbuild — CJS output for reliability with Node built-ins
await build({
  entryPoints: [join(REPO_ROOT, 'packages', 'cli', 'dist', 'index.js')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: OUT_FILE,
  external: ['better-sqlite3'],
  packages: 'bundle',
  logLevel: 'info',
  minify: false,
  sourcemap: false,
});

console.log(`[bundle] Done. Bundle size:`);
const { statSync } = await import('node:fs');
const stat = statSync(OUT_FILE);
console.log(`[bundle]   ${(stat.size / 1024).toFixed(1)} KB`);

// Copy schemas dir to resources
const schemasSrc = join(REPO_ROOT, 'schemas');
const schemasDest = join(BACKEND_OUT_DIR, 'schemas');
if (existsSync(schemasSrc)) {
  console.log('[bundle] Copying schemas...');
  await copyDir(schemasSrc, schemasDest);
}

// Copy DB schema SQL
const dbSchemaSrc = join(REPO_ROOT, 'packages', 'db', 'src', 'schema.sql');
const dbSchemaDest = join(BACKEND_OUT_DIR, 'schema.sql');
if (existsSync(dbSchemaSrc)) {
  console.log('[bundle] Copying db schema...');
  await copyFile(dbSchemaSrc, dbSchemaDest);
}

// Install better-sqlite3 (with its deps: bindings, file-uri-to-path) standalone
console.log('[bundle] Installing better-sqlite3 with deps...');
const pkgJson = {
  name: 'h-backend-runtime',
  version: '0.0.0',
  private: true,
  dependencies: { 'better-sqlite3': '^11.10.0' },
};
await writeFile(join(BACKEND_OUT_DIR, 'package.json'), JSON.stringify(pkgJson, null, 2));

const { execSync } = await import('node:child_process');
// Force all caches/temp to D: (C: drive is chronically full on this machine)
const bundleEnv = {
  ...process.env,
  npm_config_cache: 'D:/.npm-cache',
  npm_config_devdir: 'D:/.node-gyp',
  npm_config_prefer_offline: 'true',
  TMPDIR: 'D:/tmp',
  TMP: 'D:/tmp',
  TEMP: 'D:/tmp',
  LOCALAPPDATA: 'D:/.localappdata',
};
execSync('npm install --no-package-lock --no-audit --no-fund', {
  cwd: BACKEND_OUT_DIR,
  stdio: 'inherit',
  env: bundleEnv,
});

// Strip shebang that esbuild may have preserved from the entry
console.log('[bundle] Post-processing (strip shebang)...');
let bundleSrc = await readFile(OUT_FILE, 'utf-8');
bundleSrc = bundleSrc.replace(/^#!.*?\n/m, '');
await writeFile(OUT_FILE, bundleSrc);

console.log('[bundle] Backend bundle complete.');

// ---- Helpers ----
async function copyDir(src, dest, opts = {}) {
  const { readdirSync, statSync } = await import('node:fs');
  await mkdir(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    if (opts.skipDirs?.includes(entry)) continue;
    const s = join(src, entry);
    const d = join(dest, entry);
    if (statSync(s).isDirectory()) {
      await copyDir(s, d, opts);
    } else {
      await copyFile(s, d);
    }
  }
}

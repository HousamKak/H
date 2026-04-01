import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import type { ToolDefinition, ToolExecutionResult } from '@h/types';
import type { ToolHandler } from '../tool-executor.js';

export const fileReadDefinition: ToolDefinition = {
  name: 'file_read',
  description: 'Read the contents of a file at the given path',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
    },
    required: ['path'],
  },
  source: 'builtin',
  isEnabled: true,
};

export const fileReadHandler: ToolHandler = async (args, context): Promise<ToolExecutionResult> => {
  const filePath = resolve(context.workingDirectory ?? '.', args.path as string);
  if (!existsSync(filePath)) {
    return { success: false, output: null, error: `File not found: ${filePath}`, durationMs: 0 };
  }
  const content = await readFile(filePath, 'utf-8');
  return { success: true, output: content, durationMs: 0 };
};

export const fileWriteDefinition: ToolDefinition = {
  name: 'file_write',
  description: 'Write content to a file, creating directories if needed',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
      content: { type: 'string', description: 'File content to write' },
    },
    required: ['path', 'content'],
  },
  source: 'builtin',
  isEnabled: true,
};

export const fileWriteHandler: ToolHandler = async (args, context): Promise<ToolExecutionResult> => {
  const filePath = resolve(context.workingDirectory ?? '.', args.path as string);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, args.content as string, 'utf-8');
  return { success: true, output: `Written to ${filePath}`, durationMs: 0 };
};

export const fileSearchDefinition: ToolDefinition = {
  name: 'file_search',
  description: 'Search for files matching a glob pattern',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern (e.g., "**/*.ts")' },
      directory: { type: 'string', description: 'Directory to search in' },
    },
    required: ['pattern'],
  },
  source: 'builtin',
  isEnabled: true,
};

export const fileSearchHandler: ToolHandler = async (args, context): Promise<ToolExecutionResult> => {
  const { glob } = await import('node:fs');
  const { promisify } = await import('node:util');
  const dir = resolve(context.workingDirectory ?? '.', (args.directory as string) ?? '.');

  // Use a simple recursive readdir approach
  const { readdir } = await import('node:fs/promises');
  const { join, relative } = await import('node:path');

  const results: string[] = [];
  const pattern = args.pattern as string;

  async function walk(currentDir: string): Promise<void> {
    const entries = await readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const relPath = relative(dir, fullPath);
        if (matchSimpleGlob(relPath, pattern)) {
          results.push(relPath);
        }
      }
    }
  }

  await walk(dir);
  return { success: true, output: results.slice(0, 100), durationMs: 0 };
};

function matchSimpleGlob(path: string, pattern: string): boolean {
  const normalizedPath = path.replace(/\\/g, '/');
  const regex = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '<<GLOBSTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<GLOBSTAR>>/g, '.*');
  return new RegExp(`^${regex}$`).test(normalizedPath);
}

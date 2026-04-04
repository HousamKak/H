#!/usr/bin/env node
/**
 * Entry point spawned by Claude Code as an MCP stdio subprocess.
 * Parses agent context from argv, initializes the DB, and starts the MCP server.
 *
 * Usage: node stdio-entry.js --agent-id <id> --session-id <sid> --project-id <pid>
 * Env: H_DB_PATH=<path>
 */

import { getDatabase } from '@h/db';
import { HMcpServer } from './mcp-server.js';
import type { McpToolContext } from './types.js';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && argv[i + 1]) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const agentId = args['agent-id'];
  const sessionId = args['session-id'];
  const projectId = args['project-id'];
  const dbPath = process.env.H_DB_PATH ?? './data/h.db';

  if (!agentId || !sessionId || !projectId) {
    console.error('Usage: h-mcp-stdio --agent-id <id> --session-id <sid> --project-id <pid>');
    process.exit(1);
  }

  // Initialize DB connection (shared SQLite with WAL mode)
  getDatabase(dbPath);

  const context: McpToolContext = { agentId, sessionId, projectId, dbPath };
  const server = new HMcpServer(context);
  await server.start();
}

main().catch((err) => {
  console.error('[H MCP] Fatal error:', err);
  process.exit(1);
});

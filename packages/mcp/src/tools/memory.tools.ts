import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpToolContext } from '../types.js';
import { MemoryRepository } from '@h/db';
import { generateId } from '@h/types';

export function registerMemoryTools(server: McpServer, ctx: McpToolContext): void {
  const memoryRepo = new MemoryRepository();

  server.tool(
    'h_memory_store',
    'Store a memory record for future recall (facts, decisions, patterns, lessons)',
    {
      type: z.enum(['fact', 'decision', 'pattern', 'preference', 'context', 'error_lesson']),
      content: z.string().describe('The memory content'),
      tags: z.array(z.string()).optional().describe('Tags for retrieval'),
      importance: z.number().min(0).max(1).optional().describe('Importance 0-1, default 0.5'),
    },
    async (args) => {
      const record = memoryRepo.store({
        projectId: ctx.projectId,
        agentId: ctx.agentId,
        type: args.type,
        content: args.content,
        tags: args.tags,
        importance: args.importance,
      });

      return { content: [{ type: 'text' as const, text: `Memory stored: ${record.id} [${args.type}]` }] };
    },
  );

  server.tool(
    'h_memory_recall',
    'Recall memories relevant to the current work',
    {
      types: z.array(z.enum(['fact', 'decision', 'pattern', 'preference', 'context', 'error_lesson'])).optional(),
      tags: z.array(z.string()).optional(),
      limit: z.number().optional().describe('Max records, default 10'),
    },
    async (args) => {
      const records = memoryRepo.recall({
        projectId: ctx.projectId,
        types: args.types,
        tags: args.tags,
        limit: args.limit ?? 10,
        minImportance: 0.2,
      });

      if (records.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No memories found.' }] };
      }

      const text = records.map(r =>
        `[${r.type}] (importance: ${r.importance}) ${r.content}${r.tags.length ? ` tags: ${r.tags.join(', ')}` : ''}`
      ).join('\n\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}

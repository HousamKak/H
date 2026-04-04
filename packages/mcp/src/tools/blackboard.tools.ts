import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpToolContext } from '../types.js';
import { BlackboardRepository } from '@h/db';
import { generateId } from '@h/types';

export function registerBlackboardTools(server: McpServer, ctx: McpToolContext): void {
  const repo = new BlackboardRepository();

  server.tool(
    'h_blackboard_write',
    'Post an entry to the shared blackboard (visible to other agents)',
    {
      type: z.enum(['hypothesis', 'decision', 'blocker', 'discovery', 'code_context', 'test_result', 'review_comment']),
      content: z.string().describe('The content to post'),
      confidence: z.number().min(0).max(1).optional().describe('Confidence level 0-1, default 0.5'),
      scope: z.enum(['project', 'session', 'global']).optional().describe('Visibility scope, default project'),
      taskId: z.string().optional().describe('Associated task ID'),
    },
    async (args) => {
      const entry = repo.post({
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
        agentId: ctx.agentId,
        taskId: args.taskId,
        type: args.type,
        scope: args.scope ?? 'project',
        content: args.content,
        confidence: args.confidence ?? 0.5,
      });
      return { content: [{ type: 'text' as const, text: `Posted blackboard entry ${entry.id} [${entry.type}] scope=${entry.scope}` }] };
    },
  );

  server.tool(
    'h_blackboard_read',
    'Read entries from the shared blackboard',
    {
      scope: z.enum(['project', 'session', 'global']).optional().describe('Filter by scope'),
      types: z.array(z.string()).optional().describe('Filter by entry types'),
      taskId: z.string().optional().describe('Filter by task ID'),
      limit: z.number().optional().describe('Max entries to return, default 20'),
      includeResolved: z.boolean().optional().describe('Include resolved entries, default false'),
    },
    async (args) => {
      const entries = repo.query({
        projectId: args.scope === 'session' ? undefined : ctx.projectId,
        sessionId: ctx.sessionId,
        scope: args.scope,
        types: args.types as any,
        taskId: args.taskId,
        resolved: args.includeResolved ? undefined : false,
        limit: args.limit ?? 20,
      });

      if (entries.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No blackboard entries found.' }] };
      }

      const text = entries.map(e => {
        const conf = Math.round(e.confidence * 100);
        return `[${e.type}] (${conf}% by ${e.agentId.slice(0, 8)}, scope=${e.scope}) ${e.content}`;
      }).join('\n\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'h_blackboard_resolve',
    'Mark a blackboard entry as resolved',
    {
      entryId: z.string().describe('The blackboard entry ID to resolve'),
    },
    async (args) => {
      repo.resolve(args.entryId);
      return { content: [{ type: 'text' as const, text: `Resolved blackboard entry ${args.entryId}` }] };
    },
  );
}

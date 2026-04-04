import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpToolContext } from '../types.js';
import { A2ARepository } from '@h/db';
import { generateId } from '@h/types';

export function registerA2ATools(server: McpServer, ctx: McpToolContext): void {
  const a2aRepo = new A2ARepository();

  server.tool(
    'h_a2a_discover',
    'Discover other agents in the session (by capability, project, or status)',
    {
      capability: z.string().optional().describe('Filter by capability'),
      projectId: z.string().optional().describe('Filter by project'),
    },
    async (args) => {
      const cards = a2aRepo.discover({
        sessionId: ctx.sessionId,
        capability: args.capability,
        projectId: args.projectId,
      });

      // Exclude self
      const others = cards.filter(c => c.agentId !== ctx.agentId);

      if (others.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No other agents discovered.' }] };
      }

      const text = others.map(c =>
        `Agent: ${c.name} (${c.agentId.slice(0, 8)}) [${c.status}]\n  Project: ${c.projectId.slice(0, 8)}\n  Capabilities: ${c.capabilities.join(', ')}`
      ).join('\n\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'h_a2a_send',
    'Send a message to another agent',
    {
      toAgentId: z.string().optional().describe('Target agent ID (omit for capability-based routing)'),
      capability: z.string().optional().describe('Find agent by capability if toAgentId not specified'),
      type: z.enum(['message', 'task_request', 'task_response', 'artifact', 'query', 'notification']),
      subject: z.string().optional(),
      body: z.string().describe('Message body'),
      priority: z.enum(['urgent', 'normal', 'low']).optional(),
    },
    async (args) => {
      let targetAgentId = args.toAgentId;

      // Capability-based routing
      if (!targetAgentId && args.capability) {
        const cards = a2aRepo.discover({
          sessionId: ctx.sessionId,
          capability: args.capability,
        }).filter(c => c.agentId !== ctx.agentId);

        // Prefer idle agents in same project, then idle in other projects
        const sorted = cards.sort((a, b) => {
          const aScore = (a.projectId === ctx.projectId ? 2 : 0) + (a.status === 'available' ? 1 : 0);
          const bScore = (b.projectId === ctx.projectId ? 2 : 0) + (b.status === 'available' ? 1 : 0);
          return bScore - aScore;
        });

        targetAgentId = sorted[0]?.agentId;
        if (!targetAgentId) {
          return { content: [{ type: 'text' as const, text: `No agent found with capability "${args.capability}".` }] };
        }
      }

      const msg = a2aRepo.createMessage(ctx.sessionId, ctx.agentId, ctx.projectId, {
        toAgentId: targetAgentId,
        type: args.type,
        subject: args.subject,
        body: args.body,
        priority: args.priority ?? 'normal',
      });

      return { content: [{ type: 'text' as const, text: `Message sent: ${msg.id} → ${targetAgentId?.slice(0, 8) ?? 'broadcast'} [${args.type}]` }] };
    },
  );

  server.tool(
    'h_a2a_inbox',
    'Check your inbox for messages from other agents',
    {
      unreadOnly: z.boolean().optional().describe('Only show unread messages, default true'),
      type: z.enum(['message', 'task_request', 'task_response', 'artifact', 'query', 'notification', 'broadcast']).optional(),
      limit: z.number().optional().describe('Max messages, default 10'),
    },
    async (args) => {
      const messages = a2aRepo.getInbox(ctx.agentId, {
        unreadOnly: args.unreadOnly ?? true,
        type: args.type,
        limit: args.limit ?? 10,
      });

      if (messages.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No messages in inbox.' }] };
      }

      // Mark as delivered
      for (const msg of messages) {
        if (msg.status === 'pending') {
          a2aRepo.updateStatus(msg.id, 'delivered');
        }
      }

      const text = messages.map(m =>
        `From: ${m.fromAgentId.slice(0, 8)} [${m.type}] ${m.subject ? `"${m.subject}"` : ''}\n${m.body}${m.artifacts.length ? `\nArtifacts: ${m.artifacts.length}` : ''}\nID: ${m.id} | ${m.createdAt}`
      ).join('\n---\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'h_a2a_reply',
    'Reply to a message from another agent',
    {
      messageId: z.string().describe('The message ID to reply to'),
      body: z.string().describe('Reply body'),
    },
    async (args) => {
      const original = a2aRepo.findMessage(args.messageId);
      if (!original) {
        return { content: [{ type: 'text' as const, text: 'Original message not found.' }] };
      }

      // Mark original as processed
      a2aRepo.updateStatus(args.messageId, 'processed');

      const reply = a2aRepo.createMessage(ctx.sessionId, ctx.agentId, ctx.projectId, {
        toAgentId: original.fromAgentId,
        type: 'message',
        body: args.body,
        inReplyTo: args.messageId,
        correlationId: original.correlationId ?? original.id,
      });

      return { content: [{ type: 'text' as const, text: `Reply sent: ${reply.id} → ${original.fromAgentId.slice(0, 8)}` }] };
    },
  );

  server.tool(
    'h_a2a_broadcast',
    'Broadcast a message to all agents in the session',
    {
      body: z.string().describe('Broadcast message'),
      type: z.enum(['notification', 'discovery', 'message']).optional(),
    },
    async (args) => {
      const msg = a2aRepo.createMessage(ctx.sessionId, ctx.agentId, ctx.projectId, {
        type: (args.type ?? 'broadcast') as any,
        body: args.body,
      });

      return { content: [{ type: 'text' as const, text: `Broadcast sent: ${msg.id}` }] };
    },
  );
}

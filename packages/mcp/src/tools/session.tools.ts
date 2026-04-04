import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpToolContext } from '../types.js';
import { SessionRepository, ProjectRepository } from '@h/db';

export function registerSessionTools(server: McpServer, ctx: McpToolContext): void {
  const sessionRepo = new SessionRepository();
  const projectRepo = new ProjectRepository();

  server.tool(
    'h_session_context',
    'Get the current session context including active projects and focus',
    {},
    async () => {
      const session = sessionRepo.findById(ctx.sessionId);
      if (!session) {
        return { content: [{ type: 'text' as const, text: 'No active session found.' }] };
      }

      const projectIds = sessionRepo.getProjectIds(ctx.sessionId);
      const projects = projectIds.map(id => projectRepo.findById(id)).filter(Boolean);

      const lines = [
        `Session: ${session.name ?? session.id}`,
        `Status: ${session.status}`,
        `Started: ${session.startedAt}`,
        session.focusDescription ? `Focus: ${session.focusDescription}` : '',
        '',
        `Projects (${projects.length}):`,
        ...projects.map(p => `  - ${p!.name} (${p!.path})`),
        '',
        `Your project: ${ctx.projectId}`,
        `Your agent ID: ${ctx.agentId}`,
      ];

      return { content: [{ type: 'text' as const, text: lines.filter(Boolean).join('\n') }] };
    },
  );

  server.tool(
    'h_project_info',
    'Get information about a project',
    {
      projectId: z.string().optional().describe('Project ID, defaults to your current project'),
    },
    async (args) => {
      const project = projectRepo.findById(args.projectId ?? ctx.projectId);
      if (!project) {
        return { content: [{ type: 'text' as const, text: 'Project not found.' }] };
      }

      const text = [
        `Project: ${project.name}`,
        `Path: ${project.path}`,
        `Status: ${project.status}`,
        `Description: ${project.description ?? 'none'}`,
      ].join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );

  server.tool(
    'h_linked_projects',
    'Get projects linked to your current project',
    {},
    async () => {
      const links = sessionRepo.findLinks(ctx.projectId);
      if (links.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No linked projects.' }] };
      }

      const lines = links.map(link => {
        const otherId = link.sourceProjectId === ctx.projectId ? link.targetProjectId : link.sourceProjectId;
        const other = projectRepo.findById(otherId);
        return `[${link.linkType}] ${other?.name ?? otherId} — ${link.description ?? 'no description'}`;
      });

      return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
    },
  );
}

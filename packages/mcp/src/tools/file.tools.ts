import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpToolContext } from '../types.js';
import { ProjectRepository, SessionRepository } from '@h/db';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function registerFileTools(server: McpServer, ctx: McpToolContext): void {
  const projectRepo = new ProjectRepository();
  const sessionRepo = new SessionRepository();

  server.tool(
    'h_file_read_cross_project',
    'Read a file from a linked project (cross-project access)',
    {
      projectId: z.string().describe('The project ID to read from'),
      filePath: z.string().describe('Relative file path within the project'),
      startLine: z.number().optional().describe('Start line (1-indexed)'),
      endLine: z.number().optional().describe('End line'),
    },
    async (args) => {
      // Verify project is linked or in the same session
      const links = sessionRepo.findLinks(ctx.projectId);
      const sessionProjectIds = sessionRepo.getProjectIds(ctx.sessionId);
      const isLinked = links.some(l => l.sourceProjectId === args.projectId || l.targetProjectId === args.projectId);
      const isInSession = sessionProjectIds.includes(args.projectId);

      if (!isLinked && !isInSession) {
        return { content: [{ type: 'text' as const, text: 'Access denied: project is not linked or in the same session.' }] };
      }

      const project = projectRepo.findById(args.projectId);
      if (!project) {
        return { content: [{ type: 'text' as const, text: 'Project not found.' }] };
      }

      const fullPath = resolve(project.path, args.filePath);
      // Security: ensure path is within project
      if (!fullPath.startsWith(resolve(project.path))) {
        return { content: [{ type: 'text' as const, text: 'Access denied: path traversal detected.' }] };
      }

      try {
        const content = readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');

        if (args.startLine || args.endLine) {
          const start = (args.startLine ?? 1) - 1;
          const end = args.endLine ?? lines.length;
          const slice = lines.slice(start, end);
          return { content: [{ type: 'text' as const, text: slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n') }] };
        }

        return { content: [{ type: 'text' as const, text: content }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Error reading file: ${err instanceof Error ? err.message : String(err)}` }] };
      }
    },
  );

  server.tool(
    'h_file_search_cross_project',
    'Search for files in a linked project by name pattern',
    {
      projectId: z.string().describe('The project ID to search in'),
      pattern: z.string().describe('Filename pattern to search for (substring match)'),
      maxResults: z.number().optional().describe('Max results, default 20'),
    },
    async (args) => {
      // Verify access
      const sessionProjectIds = sessionRepo.getProjectIds(ctx.sessionId);
      const links = sessionRepo.findLinks(ctx.projectId);
      const isLinked = links.some(l => l.sourceProjectId === args.projectId || l.targetProjectId === args.projectId);
      const isInSession = sessionProjectIds.includes(args.projectId);

      if (!isLinked && !isInSession) {
        return { content: [{ type: 'text' as const, text: 'Access denied: project is not linked or in the same session.' }] };
      }

      const project = projectRepo.findById(args.projectId);
      if (!project) {
        return { content: [{ type: 'text' as const, text: 'Project not found.' }] };
      }

      const results: string[] = [];
      const maxResults = args.maxResults ?? 20;
      const pattern = args.pattern.toLowerCase();

      function walk(dir: string, depth: number): void {
        if (results.length >= maxResults || depth > 5) return;
        try {
          const entries = readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (results.length >= maxResults) break;
            if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
            const full = join(dir, entry.name);
            const rel = full.slice(resolve(project!.path).length + 1).replace(/\\/g, '/');
            if (entry.isFile() && entry.name.toLowerCase().includes(pattern)) {
              results.push(rel);
            } else if (entry.isDirectory()) {
              walk(full, depth + 1);
            }
          }
        } catch { /* ignore permission errors */ }
      }

      walk(resolve(project.path), 0);

      if (results.length === 0) {
        return { content: [{ type: 'text' as const, text: `No files matching "${args.pattern}" found in ${project.name}.` }] };
      }

      return { content: [{ type: 'text' as const, text: results.join('\n') }] };
    },
  );
}

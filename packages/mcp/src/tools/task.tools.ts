import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpToolContext } from '../types.js';
import { TaskRepository } from '@h/db';
import { generateId } from '@h/types';

export function registerTaskTools(server: McpServer, ctx: McpToolContext): void {
  const taskRepo = new TaskRepository();

  server.tool(
    'h_task_report',
    'Report progress or completion of your current task',
    {
      status: z.enum(['progress', 'completed', 'failed', 'blocked']).describe('Task status update'),
      summary: z.string().describe('What was done or what the issue is'),
      filesChanged: z.array(z.string()).optional().describe('Files that were modified'),
      error: z.string().optional().describe('Error message if failed'),
    },
    async (args) => {
      // Find the agent's current task
      const { AgentRepository } = await import('@h/db');
      const agentRepo = new AgentRepository();
      const agent = agentRepo.findInstance(ctx.agentId);
      if (!agent?.currentTaskId) {
        return { content: [{ type: 'text' as const, text: 'No current task assigned.' }] };
      }

      const taskId = agent.currentTaskId;

      if (args.status === 'completed') {
        taskRepo.updateStatus(taskId, 'completed', {
          result: {
            success: true,
            summary: args.summary,
            filesChanged: args.filesChanged ?? [],
            linesAdded: 0,
            linesRemoved: 0,
          },
        });
      } else if (args.status === 'failed') {
        taskRepo.updateStatus(taskId, 'failed', {
          result: {
            success: false,
            summary: args.summary,
            filesChanged: [],
            linesAdded: 0,
            linesRemoved: 0,
            errors: [args.error ?? args.summary],
          },
        });
      } else if (args.status === 'blocked') {
        taskRepo.updateStatus(taskId, 'blocked');
      }
      // 'progress' is informational only

      return { content: [{ type: 'text' as const, text: `Task ${taskId} updated: ${args.status} — ${args.summary}` }] };
    },
  );

  server.tool(
    'h_task_create_subtask',
    'Create a subtask under your current task',
    {
      title: z.string().describe('Subtask title'),
      description: z.string().describe('What needs to be done'),
      requiredRole: z.enum(['coder', 'reviewer', 'researcher', 'architect', 'foreman']).optional(),
      priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    },
    async (args) => {
      const { AgentRepository } = await import('@h/db');
      const agentRepo = new AgentRepository();
      const agent = agentRepo.findInstance(ctx.agentId);

      const task = taskRepo.create({
        projectId: ctx.projectId,
        sessionId: ctx.sessionId,
        title: args.title,
        description: args.description,
        priority: args.priority ?? 'medium',
        requiredRole: args.requiredRole ?? 'coder',
        parentTaskId: agent?.currentTaskId,
      });

      return { content: [{ type: 'text' as const, text: `Subtask created: ${task.id} — ${task.title}` }] };
    },
  );

  server.tool(
    'h_task_list',
    'List tasks in the current project or session',
    {
      projectId: z.string().optional().describe('Project to query, defaults to your project'),
      status: z.enum(['pending', 'assigned', 'in_progress', 'review', 'completed', 'failed', 'blocked']).optional(),
      limit: z.number().optional().describe('Max tasks to return, default 20'),
    },
    async (args) => {
      const tasks = taskRepo.findAll({
        projectId: args.projectId ?? ctx.projectId,
        status: args.status,
      }).slice(0, args.limit ?? 20);

      if (tasks.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No tasks found.' }] };
      }

      const text = tasks.map(t =>
        `[${t.status}] ${t.title} (${t.id.slice(0, 8)}) — ${t.priority} priority, role: ${t.requiredRole}`
      ).join('\n');

      return { content: [{ type: 'text' as const, text }] };
    },
  );
}

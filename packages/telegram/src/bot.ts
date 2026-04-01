import { Telegraf, Markup } from 'telegraf';
import type { Context } from 'telegraf';
import type { Orchestrator } from '@h/orchestrator';

export class TelegramBot {
  private bot: Telegraf;
  private orchestrator: Orchestrator;
  private allowedUserIds: Set<number>;

  constructor(token: string, orchestrator: Orchestrator, allowedUserIds?: number[]) {
    this.bot = new Telegraf(token);
    this.orchestrator = orchestrator;
    this.allowedUserIds = new Set(allowedUserIds ?? []);

    this.setupMiddleware();
    this.setupCommands();
    this.setupEventForwarding();
  }

  private setupMiddleware(): void {
    // Auth guard
    this.bot.use(async (ctx, next) => {
      const userId = ctx.from?.id;
      if (this.allowedUserIds.size > 0 && userId && !this.allowedUserIds.has(userId)) {
        await ctx.reply('Unauthorized. Your user ID: ' + userId);
        return;
      }
      await next();
    });
  }

  private setupCommands(): void {
    this.bot.command('start', async (ctx) => {
      const response = await this.orchestrator.handleMessage('/status', 'telegram');
      await ctx.reply(formatTelegram(response), { parse_mode: 'Markdown' });
    });

    this.bot.command('status', async (ctx) => {
      const response = await this.orchestrator.handleMessage('/status', 'telegram');
      await ctx.reply(formatTelegram(response), { parse_mode: 'Markdown' });
    });

    this.bot.command('projects', async (ctx) => {
      const response = await this.orchestrator.handleMessage('/projects', 'telegram');
      await ctx.reply(formatTelegram(response), { parse_mode: 'Markdown' });
    });

    this.bot.command('project', async (ctx) => {
      const name = ctx.message.text.replace(/^\/project\s*/, '').trim();
      const response = await this.orchestrator.handleMessage(`/project ${name}`, 'telegram');
      await ctx.reply(formatTelegram(response), { parse_mode: 'Markdown' });
    });

    this.bot.command('task', async (ctx) => {
      const text = ctx.message.text.replace(/^\/task\s*/, '').trim();
      if (!text) {
        await ctx.reply('Usage: /task <description>');
        return;
      }
      const response = await this.orchestrator.handleMessage(`/task ${text}`, 'telegram');
      await ctx.reply(formatTelegram(response), { parse_mode: 'Markdown' });
    });

    this.bot.command('agents', async (ctx) => {
      const response = await this.orchestrator.handleMessage('/agents', 'telegram');
      await ctx.reply(formatTelegram(response), { parse_mode: 'Markdown' });
    });

    this.bot.command('spawn', async (ctx) => {
      const role = ctx.message.text.replace(/^\/spawn\s*/, '').trim() || 'coder';
      const response = await this.orchestrator.handleMessage(`/spawn ${role}`, 'telegram');
      await ctx.reply(formatTelegram(response), { parse_mode: 'Markdown' });
    });

    this.bot.command('stop', async (ctx) => {
      const agentId = ctx.message.text.replace(/^\/stop\s*/, '').trim();
      if (!agentId) {
        await ctx.reply('Usage: /stop <agentId>');
        return;
      }
      const response = await this.orchestrator.handleMessage(`/stop ${agentId}`, 'telegram');
      await ctx.reply(formatTelegram(response), { parse_mode: 'Markdown' });
    });

    this.bot.command('memory', async (ctx) => {
      const query = ctx.message.text.replace(/^\/memory\s*/, '').trim();
      const response = await this.orchestrator.handleMessage(`/memory ${query}`, 'telegram');
      await ctx.reply(formatTelegram(response), { parse_mode: 'Markdown' });
    });

    this.bot.command('help', async (ctx) => {
      await ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' });
    });

    // Free-text messages → orchestrator
    this.bot.on('text', async (ctx) => {
      const response = await this.orchestrator.handleMessage(ctx.message.text, 'telegram');
      await ctx.reply(formatTelegram(response), { parse_mode: 'Markdown' });
    });
  }

  private setupEventForwarding(): void {
    // Notify on task completion
    this.orchestrator.events.on('task.completed', async (event) => {
      const payload = event.payload as any;
      const message = `✅ *Task completed*\n${payload.result?.summary ?? payload.taskId}`;
      await this.broadcastToAllowed(message);
    });

    // Notify on task failure
    this.orchestrator.events.on('task.failed', async (event) => {
      const payload = event.payload as any;
      const message = `❌ *Task failed*\n${payload.error ?? payload.taskId}`;
      await this.broadcastToAllowed(message);
    });

    // Notify on agent error
    this.orchestrator.events.on('agent.error', async (event) => {
      const payload = event.payload as any;
      const message = `⚠️ *Agent error*\n${payload.error}`;
      await this.broadcastToAllowed(message);
    });
  }

  private async broadcastToAllowed(message: string): Promise<void> {
    for (const userId of this.allowedUserIds) {
      try {
        await this.bot.telegram.sendMessage(userId, message, { parse_mode: 'Markdown' });
      } catch {
        // User may have blocked bot, ignore
      }
    }
  }

  async start(): Promise<void> {
    await this.bot.launch();
    console.log('[H] Telegram bot started');
  }

  async stop(): Promise<void> {
    this.bot.stop('SIGTERM');
  }
}

function formatTelegram(text: string): string {
  // Convert ## headers to bold (Telegram Markdown doesn't support headers)
  return text
    .replace(/^## (.+)$/gm, '*$1*')
    .replace(/^### (.+)$/gm, '*$1*');
}

const HELP_TEXT = `*H Assistant — Commands*

/status — System overview
/projects — List all projects
/project <name> — Switch to project
/task <description> — Create a task
/agents — List active agents
/spawn <role> — Spawn agent (coder/reviewer/researcher/architect)
/stop <id> — Stop an agent
/memory [query] — Search memory
/help — This help

Or just send a message — it becomes a task in the current project.`;

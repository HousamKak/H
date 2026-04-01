#!/usr/bin/env node

import { Command } from 'commander';
import { Orchestrator } from '@h/orchestrator';
import { startApiServer } from '@h/api';
import { TelegramBot } from '@h/telegram';
import { resolve } from 'node:path';

const program = new Command();

program
  .name('h')
  .description('H — Personal AI Coding Orchestrator')
  .version('0.1.0');

// Global orchestrator instance (lazy init)
let orchestrator: Orchestrator | null = null;

function getOrchestrator(): Orchestrator {
  if (!orchestrator) {
    const schemasDir = resolve(import.meta.dirname, '..', '..', '..', 'schemas');
    const dbPath = process.env.H_DB_PATH ?? resolve(import.meta.dirname, '..', '..', '..', 'data', 'h.db');
    orchestrator = new Orchestrator(schemasDir, dbPath);
  }
  return orchestrator;
}

// ---- Start command (runs API + optional Telegram) ----
program
  .command('start')
  .description('Start the H orchestrator (API server + optional Telegram bot)')
  .option('-p, --port <port>', 'API port', '3100')
  .option('--no-telegram', 'Disable Telegram bot')
  .action(async (opts) => {
    const orch = getOrchestrator();
    await orch.initialize();

    // Start API server
    await startApiServer(orch, parseInt(opts.port));

    // Start Telegram bot if token provided
    if (opts.telegram && process.env.H_TELEGRAM_BOT_TOKEN) {
      const allowedIds = process.env.H_TELEGRAM_ALLOWED_USER_IDS
        ?.split(',').map(Number).filter(Boolean) ?? [];
      const bot = new TelegramBot(process.env.H_TELEGRAM_BOT_TOKEN, orch, allowedIds);
      await bot.start();
    }

    // Graceful shutdown
    const shutdown = async () => {
      console.log('\n[H] Shutting down...');
      await orch.shutdown();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

// ---- Status ----
program
  .command('status')
  .description('Show system status')
  .action(async () => {
    const orch = getOrchestrator();
    await orch.initialize();
    console.log(await orch.handleMessage('/status', 'cli'));
    await orch.shutdown();
  });

// ---- Projects ----
program
  .command('projects')
  .description('List all projects')
  .action(async () => {
    const orch = getOrchestrator();
    await orch.initialize();
    console.log(await orch.handleMessage('/projects', 'cli'));
    await orch.shutdown();
  });

program
  .command('project')
  .description('Add or switch project')
  .argument('[name]', 'Project name')
  .option('--path <path>', 'Project filesystem path')
  .option('--description <desc>', 'Project description')
  .action(async (name, opts) => {
    const orch = getOrchestrator();
    await orch.initialize();

    if (opts.path) {
      const project = orch.createProject({
        name,
        path: resolve(opts.path),
        description: opts.description,
      });
      console.log(`Project created: ${project.name} (${project.id})`);
    } else if (name) {
      console.log(await orch.handleMessage(`/project ${name}`, 'cli'));
    } else {
      console.log(await orch.handleMessage('/projects', 'cli'));
    }

    await orch.shutdown();
  });

// ---- Task ----
program
  .command('task')
  .description('Create a new task')
  .argument('<description...>', 'Task description')
  .option('-p, --priority <level>', 'Priority: critical|high|medium|low', 'medium')
  .option('-r, --role <role>', 'Required agent role', 'coder')
  .option('--project <name>', 'Project name')
  .action(async (descParts, opts) => {
    const orch = getOrchestrator();
    await orch.initialize();

    if (opts.project) orch.setCurrentProject(opts.project);
    const desc = descParts.join(' ');
    console.log(await orch.handleMessage(`/task ${desc} -p ${opts.priority} -r ${opts.role}`, 'cli'));

    await orch.shutdown();
  });

// ---- Agents ----
program
  .command('agents')
  .description('List active agents')
  .action(async () => {
    const orch = getOrchestrator();
    await orch.initialize();
    console.log(await orch.handleMessage('/agents', 'cli'));
    await orch.shutdown();
  });

program
  .command('spawn')
  .description('Spawn a new agent')
  .argument('<role>', 'Agent role: coder|reviewer|researcher|architect|foreman')
  .option('--project <name>', 'Project name')
  .action(async (role, opts) => {
    const orch = getOrchestrator();
    await orch.initialize();

    if (opts.project) orch.setCurrentProject(opts.project);
    console.log(await orch.handleMessage(`/spawn ${role}`, 'cli'));

    await orch.shutdown();
  });

// ---- Chat ----
program
  .command('ask')
  .description('Ask a question or send a command')
  .argument('<message...>', 'Your message')
  .action(async (messageParts) => {
    const orch = getOrchestrator();
    await orch.initialize();

    const message = messageParts.join(' ');
    console.log(await orch.handleMessage(message, 'cli'));

    await orch.shutdown();
  });

program.parse();

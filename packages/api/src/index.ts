import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { Orchestrator } from '@h/orchestrator';
import type { HEvent } from '@h/types';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { TaskGraphRepository, TraceRepository, EpisodeRepository, CheckpointRepository, WorkspaceRepository } from '@h/db';
import { McpConfigGenerator } from '@h/mcp';

export async function startApiServer(orchestrator: Orchestrator, port?: number): Promise<void> {
  const app = express();
  const server = createServer(app);

  // Dual WebSocket: /ws for events, /ws/terminals/:id for terminal streaming
  const eventsWss = new WebSocketServer({ noServer: true });
  const terminalsWss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/ws') {
      eventsWss.handleUpgrade(req, socket, head, (ws) => eventsWss.emit('connection', ws, req));
    } else if (url.pathname.startsWith('/ws/terminals/')) {
      const terminalId = url.pathname.slice('/ws/terminals/'.length);
      terminalsWss.handleUpgrade(req, socket, head, (ws) => {
        (ws as any)._terminalId = terminalId;
        terminalsWss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  app.use(cors());
  app.use(express.json());

  // ---- Health ----
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // ---- Sessions (always-on, unlimited concurrent) ----
  app.get('/api/sessions', (req, res) => {
    const status = req.query.status as ('active' | 'ended' | undefined);
    res.json(orchestrator.getSessions(status ? { status } : undefined));
  });

  app.get('/api/sessions/active', (_req, res) => {
    res.json(orchestrator.getActiveSessions());
  });

  app.get('/api/sessions/focused', (_req, res) => {
    const session = orchestrator.getFocusedSession();
    if (!session) return res.status(404).json({ error: 'No focused session' });
    res.json(session);
  });

  app.post('/api/sessions', async (req, res) => {
    try {
      const session = await orchestrator.startSession(req.body);
      res.status(201).json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/sessions/:id/end', async (req, res) => {
    try {
      await orchestrator.endSession(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/sessions/:id/focus', async (req, res) => {
    try {
      const session = orchestrator.setFocusedSession(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found or not active' });
      res.json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/sessions/:id/projects', (req, res) => {
    res.json(orchestrator.getSessionProjects(req.params.id));
  });

  app.post('/api/sessions/:id/projects', async (req, res) => {
    try {
      const { projectId, isPrimary } = req.body;
      await orchestrator.addProjectToSession(req.params.id, projectId, isPrimary);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/sessions/:id/projects/:projectId', async (req, res) => {
    try {
      await orchestrator.removeProjectFromSession(req.params.id, req.params.projectId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- Project Links ----
  app.get('/api/project-links/:projectId', (req, res) => {
    res.json(orchestrator.getLinkedProjects(req.params.projectId));
  });

  app.post('/api/project-links', async (req, res) => {
    try {
      const link = await orchestrator.linkProjects(req.body);
      res.status(201).json(link);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- Projects ----
  app.get('/api/projects', (_req, res) => {
    res.json(orchestrator.getProjects());
  });

  app.post('/api/projects', async (req, res) => {
    const project = orchestrator.createProject(req.body);
    res.status(201).json(project);
  });

  app.get('/api/projects/:id', (req, res) => {
    const project = orchestrator.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Not found' });
    res.json(project);
  });

  // ---- Tasks ----
  app.get('/api/tasks', (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    res.json(orchestrator.getTasks(projectId));
  });

  app.post('/api/tasks', async (req, res) => {
    try {
      const task = await orchestrator.createTask(req.body);
      res.status(201).json(task);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/tasks/:id', (req, res) => {
    const task = orchestrator.getTask(req.params.id);
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(task);
  });

  // ---- Agents ----
  app.get('/api/agents/definitions', (_req, res) => {
    res.json(orchestrator.agents.getAllDefinitions());
  });

  app.get('/api/agents', (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    res.json(orchestrator.getAgents(projectId));
  });

  app.post('/api/agents/spawn', async (req, res) => {
    try {
      const { role, projectId } = req.body;
      const agent = await orchestrator.spawnAgent(role, projectId);
      res.status(201).json(agent);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[H] Spawn error:', message);
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/agents/:id', async (req, res) => {
    await orchestrator.stopAgent(req.params.id);
    res.json({ ok: true });
  });

  // ---- Chat ----
  app.post('/api/chat', async (req, res) => {
    try {
      const { message } = req.body;
      const response = await orchestrator.handleMessage(message, 'api');
      res.json({ response });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- Queue Status ----
  app.get('/api/queue', (req, res) => {
    const projectId = req.query.projectId as string | undefined;
    res.json(orchestrator.queue.getQueueSnapshot(projectId));
  });

  // ---- Blackboard ----
  app.get('/api/blackboard', (req, res) => {
    try {
      const projectId = req.query.projectId as string;
      const sessionId = req.query.sessionId as string | undefined;
      const type = req.query.type as string | undefined;
      const taskId = req.query.taskId as string | undefined;
      const entries = orchestrator.blackboard.query({
        projectId: projectId || undefined,
        sessionId,
        types: type ? [type as any] : undefined,
        taskId,
      });
      res.json(entries);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/blackboard', (req, res) => {
    try {
      const { projectId, sessionId, agentId, type, scope, content, confidence, taskId } = req.body;
      if (!agentId || !type || !content) {
        return res.status(400).json({ error: 'agentId, type, and content are required' });
      }
      const entry = orchestrator.blackboard.post({
        projectId: projectId ?? '',
        sessionId,
        agentId,
        type,
        scope,
        content,
        confidence,
        taskId,
      });
      res.status(201).json(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/blackboard/:id/resolve', (req, res) => {
    try {
      const { agentId } = req.body;
      if (!agentId) return res.status(400).json({ error: 'agentId is required' });
      orchestrator.blackboard.resolve(req.params.id, agentId);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- Task Graphs ----
  const graphRepo = new TaskGraphRepository();

  app.get('/api/graphs', (req, res) => {
    try {
      const projectId = req.query.projectId as string;
      if (!projectId) return res.status(400).json({ error: 'projectId is required' });
      res.json(graphRepo.findByProject(projectId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/graphs/:id', (req, res) => {
    try {
      const graph = graphRepo.findById(req.params.id);
      if (!graph) return res.status(404).json({ error: 'Not found' });
      res.json(graph);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/graphs', async (req, res) => {
    try {
      const { projectId, sessionId, rootTaskId, nodes, strategy, isCrossProject } = req.body;
      if (!projectId || !rootTaskId || !nodes) {
        return res.status(400).json({ error: 'projectId, rootTaskId, and nodes are required' });
      }

      let graph;
      if (isCrossProject && sessionId) {
        graph = orchestrator.graphs.createCrossProjectGraph(
          projectId, sessionId, rootTaskId, nodes, strategy,
        );
      } else {
        graph = orchestrator.graphs.createGraph(projectId, rootTaskId, nodes, strategy);
      }
      res.status(201).json(graph);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/graphs/:id/materialize', async (req, res) => {
    try {
      await orchestrator.graphs.materialize(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/graphs/:id/layers', (req, res) => {
    try {
      const graph = graphRepo.findById(req.params.id);
      if (!graph) return res.status(404).json({ error: 'Not found' });
      const layers = orchestrator.graphs.getExecutionLayers(graph);
      res.json(layers);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- Costs ----
  app.get('/api/costs', (req, res) => {
    try {
      const projectId = req.query.projectId as string;
      if (!projectId) return res.status(400).json({ error: 'projectId is required' });
      res.json(orchestrator.costs.findByProject(projectId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/costs/summary', (req, res) => {
    try {
      const projectId = req.query.projectId as string;
      if (!projectId) return res.status(400).json({ error: 'projectId is required' });
      const daily = orchestrator.costs.dailyTotal(projectId);
      const taskTotal = orchestrator.costs.totalForProject(projectId);
      const records = orchestrator.costs.findByProject(projectId);
      const agentTotals: Record<string, number> = {};
      for (const r of records) {
        if (r.agentId) {
          agentTotals[r.agentId] = (agentTotals[r.agentId] ?? 0) + r.costUsd;
        }
      }
      res.json({ daily, taskTotal, agentTotals });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- Traces ----
  const traceRepo = new TraceRepository();

  app.get('/api/traces/agent/:agentId', (req, res) => {
    try {
      res.json(traceRepo.findByAgent(req.params.agentId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/traces/:traceId', (req, res) => {
    try {
      res.json(traceRepo.findByTrace(req.params.traceId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- Episodes ----
  const episodeRepo = new EpisodeRepository();

  app.get('/api/episodes', (req, res) => {
    try {
      const projectId = req.query.projectId as string;
      if (!projectId) return res.status(400).json({ error: 'projectId is required' });
      res.json(episodeRepo.findByProject(projectId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- Checkpoints ----
  const checkpointRepo = new CheckpointRepository();

  app.get('/api/checkpoints/:agentId', (req, res) => {
    try {
      res.json(checkpointRepo.findByAgent(req.params.agentId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- A2A: Agent Cards ----
  app.get('/api/a2a/agents', (req, res) => {
    try {
      const sessionId = req.query.sessionId as string;
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
      const cards = orchestrator.agentCards.discover({
        sessionId,
        projectId: req.query.projectId as string | undefined,
        capability: req.query.capability as string | undefined,
      });
      res.json(cards);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- A2A: Messages ----
  app.get('/api/a2a/messages', (req, res) => {
    try {
      const agentId = req.query.agentId as string;
      if (!agentId) return res.status(400).json({ error: 'agentId is required' });
      const messages = orchestrator.a2a.getInbox(agentId, {
        unreadOnly: req.query.unreadOnly === 'true',
        limit: parseInt(req.query.limit as string) || 50,
      });
      res.json(messages);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/a2a/send', async (req, res) => {
    try {
      const { sessionId, fromAgentId, fromProjectId, ...input } = req.body;
      const msg = await orchestrator.a2a.send(sessionId, fromAgentId, fromProjectId, input);
      res.status(201).json(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/a2a/messages/:id/acknowledge', async (req, res) => {
    try {
      await orchestrator.a2a.acknowledge(req.params.id, req.body.status ?? 'read');
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // ---- A2A Permissions ----
  app.get('/api/a2a/permissions', (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    res.json(orchestrator.a2a.getAllPermissions(sessionId));
  });

  app.get('/api/a2a/permissions/pending', (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
    res.json(orchestrator.a2a.getPendingRequests(sessionId));
  });

  app.post('/api/a2a/permissions/request', (req, res) => {
    const { fromSessionId, toSessionId, requestedByAgentId } = req.body;
    if (!fromSessionId || !toSessionId) return res.status(400).json({ error: 'fromSessionId and toSessionId required' });
    res.json(orchestrator.a2a.requestPermission(fromSessionId, toSessionId, requestedByAgentId));
  });

  app.post('/api/a2a/permissions/:id/grant', (req, res) => {
    orchestrator.a2a.grantPermission(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/a2a/permissions/:id/deny', (req, res) => {
    orchestrator.a2a.denyPermission(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/a2a/permissions/:id/revoke', (req, res) => {
    orchestrator.a2a.revokePermission(req.params.id);
    res.json({ ok: true });
  });

  // ---- Workspace ----
  const workspaceRepo = new WorkspaceRepository();

  app.get('/api/workspace', (_req, res) => {
    try {
      res.json(workspaceRepo.get());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.put('/api/workspace', (req, res) => {
    try {
      const { layout, applets } = req.body;
      res.json(workspaceRepo.update('default', { layout, applets: applets ?? [] }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/workspace/reset', (_req, res) => {
    workspaceRepo.reset();
    res.json({ ok: true });
  });

  // ---- Terminals ----
  app.get('/api/terminals', async (req, res) => {
    try {
      const sessionId = req.query.sessionId as string;
      const projectId = req.query.projectId as string | undefined;
      if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
      res.json(orchestrator.terminals.getTerminals(sessionId, projectId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  // MCP config generator for Claude terminals — gives Claude access to H's state
  const mcpConfigDir = process.env.H_MCP_CONFIG_DIR ?? resolve('./data/mcp-configs');
  const mcpConfigGen = new McpConfigGenerator(mcpConfigDir);

  // Locate the MCP stdio entry point.
  // In dev: packages/mcp/dist/stdio-entry.js (relative to repo root)
  // In desktop bundle: resources/backend/h-mcp-stdio.cjs (next to h-backend.cjs)
  const mcpEntryPath = (() => {
    // Bundled desktop: h-mcp-stdio.cjs lives next to h-backend.cjs
    // __filename is defined in CJS bundles, __dirname for the dir
    const bundledPath = typeof __dirname !== 'undefined'
      ? resolve(__dirname, 'h-mcp-stdio.cjs')
      : undefined;
    if (bundledPath && existsSync(bundledPath)) return bundledPath;

    // Dev mode: resolve from repo structure
    try {
      const devPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'mcp', 'dist', 'stdio-entry.js');
      if (existsSync(devPath)) return devPath;
    } catch { /* import.meta.url may be undefined in CJS */ }

    return resolve('./packages/mcp/dist/stdio-entry.js');
  })();

  app.post('/api/terminals/spawn', async (req, res) => {
    try {
      const { sessionId, projectId, agentId, name, type, command, args: rawArgs, cwd, env } = req.body;
      if (!sessionId || !projectId || !command || !cwd) {
        return res.status(400).json({ error: 'sessionId, projectId, command, cwd are required' });
      }

      let finalArgs: string[] = rawArgs ?? [];

      // Auto-inject MCP config for Claude terminals so Claude can access H's system state
      const isClaude = command === 'claude' || command.endsWith('/claude') || command.endsWith('\\claude');
      if (isClaude) {
        try {
          const termId = `term-${Date.now().toString(36)}`;
          const dbPath = process.env.H_DB_PATH ?? resolve('./data/h.db');
          const configPath = mcpConfigGen.generate({
            agentId: termId,
            sessionId,
            projectId,
            dbPath,
            mcpEntryPath,
          });
          // Only inject if --mcp-config isn't already provided
          if (!finalArgs.includes('--mcp-config')) {
            finalArgs = [...finalArgs, '--mcp-config', configPath];
          }
        } catch { /* MCP config generation failed — spawn without it */ }
      }

      const terminal = await orchestrator.terminals.spawn({
        sessionId, projectId, agentId,
        name: name ?? command,
        type: type ?? 'shell',
        command,
        args: finalArgs,
        cwd,
        env: env ?? {},
      });
      res.status(201).json(terminal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/terminals/:id/kill', async (req, res) => {
    try {
      await orchestrator.terminals.kill(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/terminals/:id', (req, res) => {
    const terminal = orchestrator.terminals.getTerminal(req.params.id);
    if (!terminal) return res.status(404).json({ error: 'Terminal not found' });
    res.json(terminal);
  });

  // ---- WebSocket: Real-time events ----
  eventsWss.on('connection', (ws) => {
    const subId = orchestrator.events.subscribe({}, (event: HEvent) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'event', event }));
      }
    });
    ws.on('close', () => {
      orchestrator.events.unsubscribe(subId);
    });
  });

  // ---- WebSocket: Terminal streaming ----
  terminalsWss.on('connection', (ws) => {
    const terminalId = (ws as any)._terminalId as string;

    if (!terminalId || !orchestrator.terminals.isActive(terminalId)) {
      ws.send(JSON.stringify({ type: 'error', error: 'Terminal not active' }));
      ws.close();
      return;
    }

    // Subscribe to output
    const unsubOutput = orchestrator.terminals.subscribeOutput(terminalId, (data, stream) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', stream, data }));
      }
    });

    // Subscribe to exit
    const unsubExit = orchestrator.terminals.subscribeExit(terminalId, (exitCode) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', exitCode }));
      }
    });

    // Handle stdin / resize / kill from client
    ws.on('message', (msg) => {
      try {
        const parsed = JSON.parse(msg.toString());
        if (parsed.type === 'stdin' && typeof parsed.data === 'string') {
          orchestrator.terminals.write(terminalId, parsed.data);
        } else if (parsed.type === 'resize' && typeof parsed.cols === 'number' && typeof parsed.rows === 'number') {
          orchestrator.terminals.resize(terminalId, parsed.cols, parsed.rows);
        } else if (parsed.type === 'kill') {
          orchestrator.terminals.kill(terminalId).catch(() => {});
        }
      } catch { /* ignore malformed */ }
    });

    ws.on('close', () => {
      unsubOutput();
      unsubExit();
    });

    // Send ready
    ws.send(JSON.stringify({ type: 'ready', terminalId }));
  });

  const listenPort = port ?? parseInt(process.env.H_API_PORT ?? '3100');
  server.listen(listenPort, () => {
    console.log(`[H] API server running on http://localhost:${listenPort}`);
    console.log(`[H] Events WebSocket on ws://localhost:${listenPort}/ws`);
    console.log(`[H] Terminal WebSocket on ws://localhost:${listenPort}/ws/terminals/:id`);
  });
}

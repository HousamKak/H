import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { Orchestrator } from '@h/orchestrator';
import type { HEvent } from '@h/types';
import { resolve } from 'node:path';

export async function startApiServer(orchestrator: Orchestrator, port?: number): Promise<void> {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  app.use(cors());
  app.use(express.json());

  // ---- Health ----
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

  // ---- WebSocket: Real-time events ----
  wss.on('connection', (ws) => {
    const subId = orchestrator.events.subscribe({}, (event: HEvent) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'event', event }));
      }
    });

    ws.on('close', () => {
      orchestrator.events.unsubscribe(subId);
    });
  });

  const listenPort = port ?? parseInt(process.env.H_API_PORT ?? '3100');
  server.listen(listenPort, () => {
    console.log(`[H] API server running on http://localhost:${listenPort}`);
    console.log(`[H] WebSocket on ws://localhost:${listenPort}/ws`);
  });
}

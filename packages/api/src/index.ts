import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { Orchestrator } from '@h/orchestrator';
import type { HEvent } from '@h/types';
import { resolve } from 'node:path';
import { TaskGraphRepository, TraceRepository, EpisodeRepository, CheckpointRepository } from '@h/db';

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

  // ---- Sessions ----
  app.get('/api/sessions', (_req, res) => {
    res.json(orchestrator.getSessions());
  });

  app.get('/api/sessions/active', (_req, res) => {
    const session = orchestrator.getActiveSession();
    if (!session) return res.status(404).json({ error: 'No active session' });
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

  app.post('/api/sessions/pause', async (_req, res) => {
    try {
      await orchestrator.pauseSession();
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/sessions/:id/resume', async (req, res) => {
    try {
      const session = await orchestrator.resumeSession(req.params.id);
      res.json(session);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.post('/api/sessions/complete', async (_req, res) => {
    try {
      await orchestrator.completeSession();
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/sessions/projects', (_req, res) => {
    res.json(orchestrator.getSessionProjects());
  });

  app.post('/api/sessions/projects', async (req, res) => {
    try {
      const { projectId, isPrimary } = req.body;
      await orchestrator.addProjectToSession(projectId, isPrimary);
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  app.delete('/api/sessions/projects/:projectId', async (req, res) => {
    try {
      await orchestrator.removeProjectFromSession(req.params.projectId);
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

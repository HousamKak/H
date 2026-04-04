import { useState, useEffect, useCallback, useRef } from 'react';
import {
  api, connectWS,
  type Project, type AgentInstance, type Task, type HEvent, type QueueSnapshot,
  type BlackboardEntry, type TaskGraph, type CostRecord, type CostSummary, type TraceSpan,
  type Session,
} from './api.js';

// Poll interval
const POLL_MS = 3000;

export function useSession() {
  const [focusedSession, setFocusedSession] = useState<Session | null>(null);
  const [activeSessions, setActiveSessions] = useState<Session[]>([]);
  const [sessionProjects, setSessionProjects] = useState<Project[]>([]);

  const refresh = useCallback(() => {
    api.sessions.focused().then(s => setFocusedSession(s)).catch(() => setFocusedSession(null));
    api.sessions.active().then(setActiveSessions).catch(() => {});
  }, []);

  // Refresh projects when focused session changes
  useEffect(() => {
    if (focusedSession) {
      api.sessions.projects(focusedSession.id).then(setSessionProjects).catch(() => setSessionProjects([]));
    } else {
      setSessionProjects([]);
    }
  }, [focusedSession?.id]);

  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_MS); return () => clearInterval(t); }, [refresh]);

  // Backward-compat alias
  return { session: focusedSession, focusedSession, activeSessions, sessionProjects, refresh };
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const refresh = useCallback(() => {
    api.projects.list().then(setProjects).catch(() => {});
  }, []);
  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_MS); return () => clearInterval(t); }, [refresh]);
  return { projects, refresh };
}

export function useAgents(projectId?: string) {
  const [agents, setAgents] = useState<AgentInstance[]>([]);
  const refresh = useCallback(() => {
    api.agents.list(projectId).then(setAgents).catch(() => {});
  }, [projectId]);
  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_MS); return () => clearInterval(t); }, [refresh]);
  return { agents, refresh };
}

export function useTasks(projectId?: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const refresh = useCallback(() => {
    api.tasks.list(projectId).then(setTasks).catch(() => {});
  }, [projectId]);
  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_MS); return () => clearInterval(t); }, [refresh]);
  return { tasks, refresh };
}

export function useQueue(projectId?: string) {
  const [queue, setQueue] = useState<QueueSnapshot>({ pending: 0, inProgress: 0, review: 0, completed: 0, failed: 0, blocked: 0 });
  const refresh = useCallback(() => {
    api.queue(projectId).then(setQueue).catch(() => {});
  }, [projectId]);
  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_MS); return () => clearInterval(t); }, [refresh]);
  return queue;
}

export function useEvents() {
  const [events, setEvents] = useState<HEvent[]>([]);
  useEffect(() => {
    const disconnect = connectWS((event) => {
      setEvents((prev) => [...prev.slice(-200), event]);
    });
    return disconnect;
  }, []);
  return events;
}

export function useHealth() {
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const check = () => api.health().then(() => setOnline(true)).catch(() => setOnline(false));
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);
  return online;
}

// ---- New hooks for enhanced system ----

export function useBlackboard(projectId?: string) {
  const [entries, setEntries] = useState<BlackboardEntry[]>([]);
  const refresh = useCallback(() => {
    if (!projectId) return;
    api.blackboard.list(projectId).then(setEntries).catch(() => {});
  }, [projectId]);
  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_MS); return () => clearInterval(t); }, [refresh]);
  return { entries, refresh };
}

export function useGraphs(projectId?: string) {
  const [graphs, setGraphs] = useState<TaskGraph[]>([]);
  const refresh = useCallback(() => {
    if (!projectId) return;
    api.graphs.list(projectId).then(setGraphs).catch(() => {});
  }, [projectId]);
  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_MS); return () => clearInterval(t); }, [refresh]);
  return { graphs, refresh };
}

export function useCosts(projectId?: string) {
  const [records, setRecords] = useState<CostRecord[]>([]);
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const refresh = useCallback(() => {
    if (!projectId) return;
    api.costs.list(projectId).then(setRecords).catch(() => {});
    api.costs.summary(projectId).then(setSummary).catch(() => {});
  }, [projectId]);
  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);
  return { records, summary, refresh };
}

export function useTraces(agentId?: string) {
  const [spans, setSpans] = useState<TraceSpan[]>([]);
  const refresh = useCallback(() => {
    if (!agentId) return;
    api.traces.byAgent(agentId).then(setSpans).catch(() => {});
  }, [agentId]);
  useEffect(() => { refresh(); const t = setInterval(refresh, POLL_MS); return () => clearInterval(t); }, [refresh]);
  return { spans, refresh };
}

export interface TerminalLine {
  id: number;
  type: 'system' | 'user' | 'response' | 'error' | 'event';
  text: string;
  timestamp: Date;
}

export function useTerminal() {
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: 0, type: 'system', text: '> H // SYSTEM v0.1.0', timestamp: new Date() },
    { id: 1, type: 'system', text: '> Ready. Type /help for commands.', timestamp: new Date() },
  ]);
  const nextId = useRef(2);

  const addLine = useCallback((type: TerminalLine['type'], text: string) => {
    setLines((prev) => [...prev, { id: nextId.current++, type, text, timestamp: new Date() }]);
  }, []);

  const sendCommand = useCallback(async (input: string) => {
    addLine('user', `$ ${input}`);
    try {
      const { response } = await api.chat(input);
      addLine('response', response);
    } catch (err) {
      addLine('error', `ERR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [addLine]);

  return { lines, sendCommand, addLine };
}

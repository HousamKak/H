import { useState, useEffect, useCallback, useRef } from 'react';
import { api, connectWS, type Project, type AgentInstance, type Task, type HEvent, type QueueSnapshot } from './api.js';

// Poll interval
const POLL_MS = 3000;

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

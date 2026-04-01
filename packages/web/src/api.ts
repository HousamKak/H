const API_BASE = '/api';

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  status: string;
  createdAt: string;
}

export interface AgentInstance {
  id: string;
  definitionRole: string;
  projectId: string;
  status: string;
  currentTaskId?: string;
  turnCount: number;
  tokenBudget: number;
  spawnedAt: string;
  lastActiveAt: string;
  errorMessage?: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  requiredRole: string;
  assignedAgentId?: string;
  result?: { success: boolean; summary: string; filesChanged?: string[] };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface HEvent {
  id: string;
  type: string;
  timestamp: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  payload: Record<string, unknown>;
  source: string;
}

export interface QueueSnapshot {
  pending: number;
  inProgress: number;
  review: number;
  completed: number;
  failed: number;
  blocked: number;
}

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

export const api = {
  health: () => fetchJSON<{ status: string; timestamp: string }>('/health'),
  projects: {
    list: () => fetchJSON<Project[]>('/projects'),
    create: (data: { name: string; path: string; description?: string }) =>
      fetchJSON<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  },
  agents: {
    list: (projectId?: string) =>
      fetchJSON<AgentInstance[]>(`/agents${projectId ? `?projectId=${projectId}` : ''}`),
    spawn: (role: string, projectId: string) =>
      fetchJSON<AgentInstance>('/agents/spawn', {
        method: 'POST',
        body: JSON.stringify({ role, projectId }),
      }),
    stop: (id: string) =>
      fetchJSON<{ ok: boolean }>(`/agents/${id}`, { method: 'DELETE' }),
  },
  tasks: {
    list: (projectId?: string) =>
      fetchJSON<Task[]>(`/tasks${projectId ? `?projectId=${projectId}` : ''}`),
    create: (data: { projectId: string; title: string; description: string; priority?: string; requiredRole?: string }) =>
      fetchJSON<Task>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  },
  queue: (projectId?: string) =>
    fetchJSON<QueueSnapshot>(`/queue${projectId ? `?projectId=${projectId}` : ''}`),
  chat: (message: string) =>
    fetchJSON<{ response: string }>('/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
};

// WebSocket connection for real-time events
export function connectWS(onEvent: (event: HEvent) => void): () => void {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

  ws.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      if (data.type === 'event' && data.event) {
        onEvent(data.event);
      }
    } catch { /* ignore parse errors */ }
  };

  ws.onclose = () => {
    // Reconnect after 2s
    setTimeout(() => connectWS(onEvent), 2000);
  };

  return () => ws.close();
}

// In Tauri production builds, files are loaded from disk (tauri://localhost),
// so we need an absolute URL to reach the API server.
const isTauri = '__TAURI_INTERNALS__' in window;
const API_BASE = isTauri ? 'http://localhost:3100/api' : '/api';

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
  sessionId?: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  payload: Record<string, unknown>;
  source: string;
}

export interface Session {
  id: string;
  name?: string;
  status: 'active' | 'ended';
  startedAt: string;
  endedAt?: string;
  focusDescription?: string;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectLink {
  id: string;
  sourceProjectId: string;
  targetProjectId: string;
  linkType: string;
  description?: string;
}

export interface AgentCard {
  agentId: string;
  name: string;
  description: string;
  projectId: string;
  sessionId: string;
  capabilities: string[];
  status: string;
  updatedAt: string;
}

export interface A2AMessage {
  id: string;
  sessionId: string;
  fromAgentId: string;
  toAgentId?: string;
  fromProjectId: string;
  toProjectId?: string;
  type: string;
  subject?: string;
  body: string;
  priority: string;
  status: string;
  createdAt: string;
}

// Canvas viewport: pan + zoom. Stored in the workspace.layout field (opaque JSON on backend).
export interface CanvasViewport {
  x: number;
  y: number;
  zoom: number;
}

export type ShellType = 'cmd' | 'powershell' | 'pwsh' | 'bash' | 'git-bash' | 'wsl';
export type TerminalAppletKind = 'shell' | 'claude' | 'super_claude' | 'dev_server' | 'attach';

export interface TerminalAppletConfig {
  sessionId: string;
  projectId: string;
  kind: TerminalAppletKind;
  shellType?: ShellType;
  terminalId?: string;
  command?: string;
  args?: string[];
  cwd?: string;
}

export interface SessionAppletConfig {
  sessionId: string;
  label?: string;
}

export interface Applet {
  id: string;
  type: 'terminal' | 'session';
  title?: string;
  position?: { x: number; y: number };
  width?: number;
  height?: number;
  parentId?: string;
  config: TerminalAppletConfig | SessionAppletConfig;
}

export interface Workspace {
  id: string;
  // Repurposed: now holds CanvasViewport { x, y, zoom } for the infinite canvas.
  layout: CanvasViewport | null;
  applets: Applet[];
  updatedAt: string;
}

export interface TerminalInfo {
  id: string;
  sessionId: string;
  projectId: string;
  agentId?: string;
  name: string;
  type: string;
  status: string;
  pid?: number;
  command: string;
  cwd: string;
  exitCode?: number;
  startedAt: string;
  stoppedAt?: string;
}

export interface QueueSnapshot {
  pending: number;
  inProgress: number;
  review: number;
  completed: number;
  failed: number;
  blocked: number;
}

// ---- New types for enhanced system ----

export interface BlackboardEntry {
  id: string;
  projectId: string;
  agentId: string;
  taskId?: string;
  type: string;
  content: string;
  confidence: number;
  resolved: boolean;
  createdAt: string;
}

export interface TaskGraphNode {
  id: string;
  title: string;
  description: string;
  requiredRole: string;
  projectId?: string;
  dependsOn: string[];
  priority: string;
  status: string;
  taskId?: string;
}

export interface TaskGraph {
  id: string;
  projectId: string;
  sessionId?: string;
  rootTaskId: string;
  nodes: TaskGraphNode[];
  strategy: string;
  status: string;
  isCrossProject?: boolean;
  createdAt: string;
}

export interface ExecutionLayer {
  index: number;
  nodeIds: string[];
}

export interface CostRecord {
  id: string;
  agentId?: string;
  taskId?: string;
  projectId?: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  timestamp: string;
}

export interface CostSummary {
  daily: number;
  taskTotal: number;
  agentTotals: Record<string, number>;
}

export interface TraceSpan {
  id: string;
  traceId: string;
  parentSpanId?: string;
  agentId?: string;
  taskId?: string;
  operation: string;
  startTime: string;
  endTime?: string;
  status: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  model?: string;
  toolName?: string;
  errorMessage?: string;
}

export interface Episode {
  id: string;
  projectId: string;
  taskType: string;
  summary: string;
  outcome: string;
  lessonsLearned: string[];
  filesInvolved: string[];
  tokenCost: number;
  durationMs: number;
  createdAt: string;
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
  sessions: {
    list: (status?: 'active' | 'ended') =>
      fetchJSON<Session[]>(`/sessions${status ? `?status=${status}` : ''}`),
    active: () => fetchJSON<Session[]>('/sessions/active'),
    focused: () => fetchJSON<Session>('/sessions/focused').catch(() => null),
    start: (data: { name?: string; focusDescription?: string; projectIds?: string[] }) =>
      fetchJSON<Session>('/sessions', { method: 'POST', body: JSON.stringify(data) }),
    end: (id: string) => fetchJSON<{ ok: boolean }>(`/sessions/${id}/end`, { method: 'POST' }),
    focus: (id: string) => fetchJSON<Session>(`/sessions/${id}/focus`, { method: 'POST' }),
    projects: (sessionId: string) => fetchJSON<Project[]>(`/sessions/${sessionId}/projects`),
    addProject: (sessionId: string, projectId: string, isPrimary?: boolean) =>
      fetchJSON<{ ok: boolean }>(`/sessions/${sessionId}/projects`, { method: 'POST', body: JSON.stringify({ projectId, isPrimary }) }),
    removeProject: (sessionId: string, projectId: string) =>
      fetchJSON<{ ok: boolean }>(`/sessions/${sessionId}/projects/${projectId}`, { method: 'DELETE' }),
  },
  projectLinks: {
    list: (projectId: string) => fetchJSON<Array<{ project: Project; link: ProjectLink }>>(`/project-links/${projectId}`),
    create: (data: { sourceProjectId: string; targetProjectId: string; linkType: string }) =>
      fetchJSON<ProjectLink>('/project-links', { method: 'POST', body: JSON.stringify(data) }),
  },
  a2a: {
    agents: (sessionId: string, projectId?: string) =>
      fetchJSON<AgentCard[]>(`/a2a/agents?sessionId=${sessionId}${projectId ? `&projectId=${projectId}` : ''}`),
    messages: (agentId: string, limit = 50) =>
      fetchJSON<A2AMessage[]>(`/a2a/messages?agentId=${agentId}&limit=${limit}`),
    send: (data: { sessionId: string; fromAgentId: string; fromProjectId: string; toAgentId?: string; type: string; body: string }) =>
      fetchJSON<A2AMessage>('/a2a/send', { method: 'POST', body: JSON.stringify(data) }),
    acknowledge: (messageId: string) =>
      fetchJSON<{ ok: boolean }>(`/a2a/messages/${messageId}/acknowledge`, { method: 'POST', body: JSON.stringify({ status: 'read' }) }),
    permissions: {
      list: (sessionId?: string) =>
        fetchJSON<Array<{ id: string; fromSessionId: string; toSessionId: string; status: string; createdAt: string }>>(
          `/a2a/permissions${sessionId ? `?sessionId=${sessionId}` : ''}`,
        ),
      pending: (sessionId: string) =>
        fetchJSON<Array<{ id: string; fromSessionId: string; toSessionId: string; status: string; createdAt: string }>>(
          `/a2a/permissions/pending?sessionId=${sessionId}`,
        ),
      grant: (id: string) => fetchJSON<{ ok: boolean }>(`/a2a/permissions/${id}/grant`, { method: 'POST' }),
      deny: (id: string) => fetchJSON<{ ok: boolean }>(`/a2a/permissions/${id}/deny`, { method: 'POST' }),
      revoke: (id: string) => fetchJSON<{ ok: boolean }>(`/a2a/permissions/${id}/revoke`, { method: 'POST' }),
    },
  },
  workspace: {
    get: () => fetchJSON<Workspace>('/workspace'),
    update: (layout: CanvasViewport | null, applets: Applet[]) =>
      fetchJSON<Workspace>('/workspace', { method: 'PUT', body: JSON.stringify({ layout, applets }) }),
    reset: () => fetchJSON<{ ok: boolean }>('/workspace/reset', { method: 'POST' }),
  },
  terminals: {
    list: (sessionId: string, projectId?: string) =>
      fetchJSON<TerminalInfo[]>(`/terminals?sessionId=${sessionId}${projectId ? `&projectId=${projectId}` : ''}`),
    get: (id: string) => fetchJSON<TerminalInfo>(`/terminals/${id}`),
    spawn: (input: {
      sessionId: string;
      projectId: string;
      agentId?: string;
      name?: string;
      type?: string;
      command: string;
      args?: string[];
      cwd: string;
      env?: Record<string, string>;
    }) => fetchJSON<TerminalInfo>('/terminals/spawn', { method: 'POST', body: JSON.stringify(input) }),
    kill: (id: string) =>
      fetchJSON<{ ok: boolean }>(`/terminals/${id}/kill`, { method: 'POST' }),
  },
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
  blackboard: {
    list: (projectId: string, type?: string) =>
      fetchJSON<BlackboardEntry[]>(`/blackboard?projectId=${projectId}${type ? `&type=${type}` : ''}`),
    post: (entry: { projectId: string; agentId: string; type: string; content: string; confidence?: number; taskId?: string }) =>
      fetchJSON<BlackboardEntry>('/blackboard', { method: 'POST', body: JSON.stringify(entry) }),
    resolve: (id: string) =>
      fetchJSON<{ ok: boolean }>(`/blackboard/${id}/resolve`, { method: 'POST' }),
  },
  graphs: {
    list: (projectId: string) =>
      fetchJSON<TaskGraph[]>(`/graphs?projectId=${projectId}`),
    get: (id: string) =>
      fetchJSON<TaskGraph>(`/graphs/${id}`),
    layers: (id: string) =>
      fetchJSON<ExecutionLayer[]>(`/graphs/${id}/layers`),
  },
  costs: {
    list: (projectId: string) =>
      fetchJSON<CostRecord[]>(`/costs?projectId=${projectId}`),
    summary: (projectId: string) =>
      fetchJSON<CostSummary>(`/costs/summary?projectId=${projectId}`),
  },
  traces: {
    byTrace: (traceId: string) =>
      fetchJSON<TraceSpan[]>(`/traces/${traceId}`),
    byAgent: (agentId: string) =>
      fetchJSON<TraceSpan[]>(`/traces/agent/${agentId}`),
  },
  episodes: {
    list: (projectId: string) =>
      fetchJSON<Episode[]>(`/episodes?projectId=${projectId}`),
  },
};

// WebSocket connection for real-time events
export function connectWS(onEvent: (event: HEvent) => void): () => void {
  const wsUrl = isTauri
    ? 'ws://localhost:3100/ws'
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
  const ws = new WebSocket(wsUrl);

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

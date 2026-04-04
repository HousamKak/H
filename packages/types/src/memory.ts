export type MemoryType = 'fact' | 'decision' | 'pattern' | 'preference' | 'context' | 'error_lesson';

export interface MemoryRecord {
  id: string;
  projectId?: string;
  agentId?: string;
  type: MemoryType;
  content: string;
  tags: string[];
  importance: number;
  accessCount: number;
  lastAccessedAt: string;
  createdAt: string;
  expiresAt?: string;
}

export interface StoreMemoryInput {
  projectId?: string;
  agentId?: string;
  type: MemoryType;
  content: string;
  tags?: string[];
  importance?: number;
  expiresAt?: string;
}

export interface RecallMemoryQuery {
  projectId?: string;
  agentId?: string;
  types?: MemoryType[];
  tags?: string[];
  limit?: number;
  minImportance?: number;
}

// ---- Blackboard (shared agent workspace) ----

export type BlackboardEntryType =
  | 'hypothesis'
  | 'decision'
  | 'blocker'
  | 'discovery'
  | 'code_context'
  | 'test_result'
  | 'review_comment';

export type BlackboardScope = 'project' | 'session' | 'global';

export interface BlackboardEntry {
  id: string;
  projectId: string;
  sessionId?: string;
  agentId: string;
  taskId?: string;
  type: BlackboardEntryType;
  scope: BlackboardScope;
  content: string;
  confidence: number; // 0-1
  resolved: boolean;
  createdAt: string;
}

export interface BlackboardQuery {
  projectId?: string;
  sessionId?: string;
  scope?: BlackboardScope;
  types?: BlackboardEntryType[];
  taskId?: string;
  resolved?: boolean;
  limit?: number;
}

// ---- Episodic Memory ----

export interface Episode {
  id: string;
  projectId: string;
  taskType: string;
  summary: string;
  outcome: 'success' | 'failure' | 'partial';
  lessonsLearned: string[];
  filesInvolved: string[];
  tokenCost: number;
  durationMs: number;
  createdAt: string;
}

// ---- Observability ----

export interface TraceSpan {
  id: string;
  traceId: string;
  parentSpanId?: string;
  agentId?: string;
  taskId?: string;
  operation: string;
  startTime: string;
  endTime?: string;
  status: 'ok' | 'error';
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  model?: string;
  toolName?: string;
  errorMessage?: string;
}

export interface CostRecord {
  id: string;
  traceId?: string;
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

export interface CostLimits {
  perTask: number;
  perGraph: number;
  daily: number;
  perAgent: number;
}

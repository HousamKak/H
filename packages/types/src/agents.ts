import type { ProviderType, Timestamped } from './common.js';

export type AgentRole = 'coder' | 'reviewer' | 'researcher' | 'architect' | 'foreman';

export type AgentStatus = 'spawning' | 'idle' | 'working' | 'paused' | 'terminated' | 'error';

export type AgentRuntimeType = 'internal' | 'claude_code_automated' | 'claude_code_interactive';

export interface AgentDefinition {
  role: AgentRole;
  name: string;
  description: string;
  systemPrompt: string;
  capabilities: string[];
  llmProvider: ProviderType;
  model?: string;
  maxConcurrentTasks: number;
  temperature: number;
  tokenBudget: number;
  maxTurns: number;
  enableReflection?: boolean;
  reflectionInterval?: number; // reflect every N turns
}

export interface AgentInstance extends Timestamped {
  id: string;
  definitionRole: AgentRole;
  projectId: string;
  sessionId?: string;
  status: AgentStatus;
  runtimeType: AgentRuntimeType;
  currentTaskId?: string;
  terminalId?: string;
  mcpConfigPath?: string;
  turnCount: number;
  tokenBudget: number;
  spawnedAt: string;
  lastActiveAt: string;
  terminatedAt?: string;
  errorMessage?: string;
}

export interface SpawnAgentInput {
  role: AgentRole;
  projectId: string;
  sessionId?: string;
  runtimeType?: AgentRuntimeType;
  taskId?: string;
}

// ---- Context Management ----

export interface ContextAnchor {
  intent: string;
  changesMade: string[];
  decisionsTaken: string[];
  nextSteps: string[];
  tokenCount: number;
}

export interface AgentCheckpoint {
  id: string;
  agentId: string;
  taskId: string;
  timestamp: string;
  turnCount: number;
  contextAnchor: ContextAnchor;
  recentMessages: Array<{ role: string; content: string }>;
  tokenUsage: { input: number; output: number; total: number };
  gitRef?: string;
}

// ---- Error Handling ----

export type ErrorCategory =
  | 'transient'
  | 'rate_limit'
  | 'permanent'
  | 'semantic'
  | 'budget'
  | 'auth';

export interface ClassifiedError {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
}

// ---- Circuit Breaker ----

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

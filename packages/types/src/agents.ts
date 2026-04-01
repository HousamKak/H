import type { ProviderType, Timestamped } from './common.js';

export type AgentRole = 'coder' | 'reviewer' | 'researcher' | 'architect' | 'foreman';

export type AgentStatus = 'spawning' | 'idle' | 'working' | 'paused' | 'terminated' | 'error';

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
}

export interface AgentInstance extends Timestamped {
  id: string;
  definitionRole: AgentRole;
  projectId: string;
  status: AgentStatus;
  currentTaskId?: string;
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
  taskId?: string;
}

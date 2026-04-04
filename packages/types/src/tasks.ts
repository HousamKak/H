import type { AgentRole } from './agents.js';
import type { Timestamped } from './common.js';

export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'review'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export interface TaskResult {
  success: boolean;
  summary: string;
  filesChanged: string[];
  linesAdded: number;
  linesRemoved: number;
  errors?: string[];
  reviewNotes?: string;
}

export interface Task extends Timestamped {
  id: string;
  projectId: string;
  sessionId?: string;
  parentTaskId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  requiredRole: AgentRole;
  assignedAgentId?: string;
  dependencies: string[];
  subtasks: string[];
  result?: TaskResult;
  startedAt?: string;
  completedAt?: string;
}

export interface CreateTaskInput {
  projectId: string;
  sessionId?: string;
  title: string;
  description: string;
  priority?: TaskPriority;
  requiredRole?: AgentRole;
  parentTaskId?: string;
  dependencies?: string[];
  graphId?: string;
}

// ---- Task Graph (DAG decomposition) ----

export interface TaskGraphNode {
  id: string;
  title: string;
  description: string;
  requiredRole: AgentRole;
  projectId?: string; // for cross-project graphs
  dependsOn: string[];
  priority: TaskPriority;
  acceptanceCriteria: string[];
  status: TaskStatus;
  taskId?: string; // linked Task ID once created
}

export interface TaskGraph {
  id: string;
  projectId: string;
  sessionId?: string;
  rootTaskId: string;
  nodes: TaskGraphNode[];
  strategy: 'sequential' | 'parallel' | 'mixed';
  status: 'planning' | 'executing' | 'completed' | 'failed';
  isCrossProject: boolean;
  createdAt: string;
  completedAt?: string;
}

export interface ExecutionLayer {
  index: number;
  nodeIds: string[];
}

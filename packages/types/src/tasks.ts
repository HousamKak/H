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
  title: string;
  description: string;
  priority?: TaskPriority;
  requiredRole?: AgentRole;
  parentTaskId?: string;
  dependencies?: string[];
}

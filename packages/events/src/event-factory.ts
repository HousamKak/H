import type {
  Project,
  AgentInstance,
  Task,
  MemoryRecord,
  ToolCall,
  ToolResult,
} from '@h/types';

// Typed payload shapes for each event type

export interface ProjectCreatedPayload { project: Project }
export interface ProjectUpdatedPayload { project: Project; changes: string[] }
export interface ProjectArchivedPayload { projectId: string }

export interface AgentSpawnedPayload { agent: AgentInstance }
export interface AgentStatusPayload { agentId: string; previousStatus: string; reason?: string }
export interface AgentProgressPayload { agentId: string; summary: string; turnCount: number }
export interface AgentErrorPayload { agentId: string; error: string; stack?: string }

export interface TaskCreatedPayload { task: Task }
export interface TaskAssignedPayload { taskId: string; agentId: string }
export interface TaskStartedPayload { taskId: string; agentId: string }
export interface TaskProgressPayload { taskId: string; summary: string; percentComplete?: number }
export interface TaskCompletedPayload { taskId: string; result: Task['result'] }
export interface TaskFailedPayload { taskId: string; error: string }
export interface TaskBlockedPayload { taskId: string; reason: string; blockedBy?: string }

export interface MessageReceivedPayload { content: string; source: string; conversationId?: string }
export interface MessageSentPayload { content: string; target: string; conversationId?: string }

export interface ToolInvokedPayload { toolCall: ToolCall; agentId: string }
export interface ToolCompletedPayload { toolResult: ToolResult; agentId: string }
export interface ToolErrorPayload { toolName: string; error: string; agentId: string }

export interface MemoryStoredPayload { record: MemoryRecord }
export interface MemoryRecalledPayload { query: string; resultCount: number }

export interface SystemPayload { message: string }

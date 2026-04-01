export type EventType =
  // Project events
  | 'project.created'
  | 'project.updated'
  | 'project.archived'
  // Agent events
  | 'agent.spawned'
  | 'agent.idle'
  | 'agent.started'
  | 'agent.paused'
  | 'agent.resumed'
  | 'agent.terminated'
  | 'agent.error'
  | 'agent.progress'
  // Task events
  | 'task.created'
  | 'task.assigned'
  | 'task.started'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'task.blocked'
  | 'task.cancelled'
  | 'task.review_requested'
  // Message events
  | 'message.received'
  | 'message.sent'
  // Tool events
  | 'tool.invoked'
  | 'tool.completed'
  | 'tool.error'
  // Memory events
  | 'memory.stored'
  | 'memory.recalled'
  // System events
  | 'system.started'
  | 'system.shutdown'
  | 'system.error';

export interface HEvent<T = Record<string, unknown>> {
  id: string;
  type: EventType;
  timestamp: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  payload: T;
  metadata: EventMetadata;
}

export interface EventMetadata {
  source: string;
  correlationId?: string;
  causationId?: string;
}

export type EventHandler<T = Record<string, unknown>> = (event: HEvent<T>) => void | Promise<void>;

export type EventFilter = {
  types?: EventType[];
  projectId?: string;
  agentId?: string;
  taskId?: string;
};

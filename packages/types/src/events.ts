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
  // Graph events
  | 'graph.created'
  | 'graph.layer.started'
  | 'graph.layer.completed'
  | 'graph.completed'
  | 'graph.failed'
  // Blackboard events
  | 'blackboard.updated'
  // Agent lifecycle events
  | 'agent.reflecting'
  | 'agent.checkpoint'
  | 'agent.context.compacted'
  // Escalation events
  | 'escalation.requested'
  // Cost events
  | 'cost.recorded'
  | 'cost.threshold.warning'
  // Session events
  | 'session.started'
  | 'session.paused'
  | 'session.resumed'
  | 'session.completed'
  | 'session.project.added'
  | 'session.project.removed'
  // Terminal events
  | 'terminal.spawned'
  | 'terminal.output'
  | 'terminal.exited'
  | 'terminal.error'
  // A2A events
  | 'a2a.message.sent'
  | 'a2a.message.delivered'
  | 'a2a.message.read'
  | 'a2a.agent.registered'
  | 'a2a.agent.unregistered'
  // Claude Code events
  | 'claude_code.spawned'
  | 'claude_code.output'
  | 'claude_code.tool_use'
  | 'claude_code.completed'
  | 'claude_code.error'
  // Project link events
  | 'project.linked'
  | 'project.unlinked'
  // System events
  | 'system.started'
  | 'system.shutdown'
  | 'system.error';

export interface HEvent<T = Record<string, unknown>> {
  id: string;
  type: EventType;
  timestamp: string;
  sessionId?: string;
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
  sessionId?: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
};

export type A2AMessageType =
  | 'message'
  | 'task_request'
  | 'task_response'
  | 'artifact'
  | 'query'
  | 'notification'
  | 'broadcast';

export type A2AMessageStatus = 'pending' | 'delivered' | 'read' | 'processed' | 'failed';

export type A2AMessagePriority = 'urgent' | 'normal' | 'low';

export type AgentCardStatus = 'available' | 'busy' | 'offline';

export interface A2AArtifact {
  name: string;
  type: string; // e.g., 'code', 'file_ref', 'json', 'text'
  content: string;
}

export interface A2AMessage {
  id: string;
  sessionId: string;
  fromAgentId: string;
  toAgentId?: string;
  fromProjectId: string;
  toProjectId?: string;
  type: A2AMessageType;
  subject?: string;
  body: string;
  artifacts: A2AArtifact[];
  correlationId?: string;
  inReplyTo?: string;
  priority: A2AMessagePriority;
  status: A2AMessageStatus;
  createdAt: string;
  deliveredAt?: string;
  processedAt?: string;
}

export interface AgentCard {
  agentId: string;
  name: string;
  description: string;
  projectId: string;
  sessionId: string;
  capabilities: string[];
  skills: string[];
  endpoint: string;
  status: AgentCardStatus;
  updatedAt: string;
}

export interface SendA2AMessageInput {
  toAgentId?: string;
  toProjectId?: string;
  capability?: string; // for capability-based routing
  type: A2AMessageType;
  subject?: string;
  body: string;
  artifacts?: A2AArtifact[];
  priority?: A2AMessagePriority;
  correlationId?: string;
  inReplyTo?: string;
}

export interface A2AInboxFilter {
  unreadOnly?: boolean;
  type?: A2AMessageType;
  fromAgentId?: string;
  limit?: number;
}

export interface RegisterAgentCardInput {
  agentId: string;
  name: string;
  description: string;
  projectId: string;
  sessionId: string;
  capabilities: string[];
  skills?: string[];
  endpoint?: string;
}

export interface DiscoverAgentsFilter {
  sessionId: string;
  capability?: string;
  projectId?: string;
  status?: AgentCardStatus;
}

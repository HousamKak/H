import type { Timestamped } from './common.js';

export type SessionStatus = 'active' | 'ended';

export interface SessionConfig {
  costLimit?: number;
  autoAssign: boolean;
  notifyOnCompletion: boolean;
}

// Deprecated — kept for migration compatibility, no longer populated
export interface SessionSnapshot {
  activeAgentIds: string[];
  pendingTaskIds: string[];
  runningTerminalIds: string[];
  blackboardSummary: string;
  lastActivity: string;
}

export interface Session extends Timestamped {
  id: string;
  name?: string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  focusDescription?: string;
  config: SessionConfig;
}

export interface CreateSessionInput {
  name?: string;
  focusDescription?: string;
  projectIds?: string[];
  config?: Partial<SessionConfig>;
}

export type LinkType = 'related' | 'depends_on' | 'frontend_backend' | 'monorepo_sibling' | 'api_consumer';

export interface ProjectLink extends Timestamped {
  id: string;
  sourceProjectId: string;
  targetProjectId: string;
  linkType: LinkType;
  description?: string;
  config: Record<string, unknown>;
}

export interface CreateProjectLinkInput {
  sourceProjectId: string;
  targetProjectId: string;
  linkType: LinkType;
  description?: string;
}

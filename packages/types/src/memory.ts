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

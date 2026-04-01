import type { ProviderType, Timestamped } from './common.js';

export type ProjectStatus = 'active' | 'paused' | 'archived';

export interface ProjectConfig {
  defaultLLMProvider: ProviderType;
  defaultModel?: string;
  gitBranch?: string;
  techStack?: string[];
  conventions?: string[];
  memoryNamespace: string;
}

export interface Project extends Timestamped {
  id: string;
  name: string;
  path: string;
  description?: string;
  status: ProjectStatus;
  config: ProjectConfig;
}

export interface CreateProjectInput {
  name: string;
  path: string;
  description?: string;
  config?: Partial<ProjectConfig>;
}

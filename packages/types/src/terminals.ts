import type { Timestamped } from './common.js';

export type TerminalType =
  | 'shell'
  | 'claude_code_automated'
  | 'claude_code_interactive'
  | 'dev_server'
  | 'watcher';

export type TerminalStatus = 'starting' | 'running' | 'stopped' | 'crashed' | 'completed';

export interface Terminal extends Timestamped {
  id: string;
  sessionId: string;
  projectId: string;
  agentId?: string;
  name: string;
  type: TerminalType;
  status: TerminalStatus;
  pid?: number;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  exitCode?: number;
  startedAt: string;
  stoppedAt?: string;
}

export interface SpawnTerminalInput {
  sessionId: string;
  projectId: string;
  agentId?: string;
  name: string;
  type: TerminalType;
  command: string;
  args?: string[];
  cwd: string;
  env?: Record<string, string>;
}

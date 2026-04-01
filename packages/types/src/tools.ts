export type ToolSource = 'builtin' | 'mcp' | 'plugin';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  source: ToolSource;
  mcpServerUrl?: string;
  isEnabled: boolean;
}

export interface ToolExecutionRequest {
  toolName: string;
  arguments: Record<string, unknown>;
  agentId: string;
  taskId?: string;
  projectId?: string;
  workingDirectory?: string;
}

export interface ToolExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
}

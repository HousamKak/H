/**
 * Context injected into every MCP tool handler.
 * Contains the agent/session/project identity of the calling Claude Code agent.
 */
export interface McpToolContext {
  agentId: string;
  sessionId: string;
  projectId: string;
  dbPath: string;
}

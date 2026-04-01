import type { InterfaceSource } from './common.js';

export type MessageRole = 'user' | 'agent' | 'system' | 'tool';

export interface ToolCall {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  success: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  agentId?: string;
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  tokenCount?: number;
  timestamp: string;
}

export interface Conversation {
  id: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  interfaceSource: InterfaceSource;
  createdAt: string;
  updatedAt: string;
}

export interface SendMessageInput {
  conversationId?: string;
  projectId?: string;
  content: string;
  interfaceSource: InterfaceSource;
}

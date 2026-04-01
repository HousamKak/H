import type { ProviderType } from '@h/types';

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateParams {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
}

export interface GenerateResult {
  content: string;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'unknown';
}

export interface StructuredGenerateParams<T = unknown> extends GenerateParams {
  schema: Record<string, unknown>;
  schemaName?: string;
}

export interface LLMProvider {
  name: string;
  type: ProviderType;
  isAvailable(): Promise<boolean>;
  generate(params: GenerateParams): Promise<GenerateResult>;
  generateStructured?<T>(params: StructuredGenerateParams<T>): Promise<T>;
}

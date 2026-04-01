export type ProviderType = 'claude' | 'openai' | 'gemini' | 'claude-code' | 'mock';

export type InterfaceSource = 'telegram' | 'api' | 'cli' | 'system' | 'websocket';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface HConfig {
  dbPath: string;
  apiPort: number;
  apiHost: string;
  defaultLLMProvider: ProviderType;
  telegramBotToken?: string;
  telegramAllowedUserIds?: number[];
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleAiApiKey?: string;
  logLevel: LogLevel;
}

export interface Timestamped {
  createdAt: string;
  updatedAt: string;
}

export function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

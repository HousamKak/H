import OpenAI from 'openai';
import type { LLMProvider, GenerateParams, GenerateResult, StructuredGenerateParams } from '../types.js';

export class OpenAIProvider implements LLMProvider {
  name = 'OpenAI';
  type = 'openai' as const;
  private client: OpenAI;
  private defaultModel: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new OpenAI({ apiKey: apiKey ?? process.env.OPENAI_API_KEY });
    this.defaultModel = model ?? 'gpt-4o';
  }

  async isAvailable(): Promise<boolean> {
    return !!process.env.OPENAI_API_KEY;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const messages = params.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    const response = await this.client.chat.completions.create({
      model: params.model ?? this.defaultModel,
      messages,
      max_tokens: params.maxTokens ?? 8192,
      temperature: params.temperature ?? 0.7,
      stop: params.stopSequences,
    });

    const choice = response.choices[0];
    return {
      content: choice?.message?.content ?? '',
      model: response.model,
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
      finishReason: choice?.finish_reason === 'stop' ? 'end_turn'
        : choice?.finish_reason === 'length' ? 'max_tokens'
        : 'unknown',
    };
  }

  async generateStructured<T>(params: StructuredGenerateParams<T>): Promise<T> {
    const messages = params.messages.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    }));

    const response = await this.client.chat.completions.create({
      model: params.model ?? this.defaultModel,
      messages,
      max_tokens: params.maxTokens ?? 8192,
      temperature: params.temperature ?? 0.7,
      response_format: { type: 'json_object' },
    });

    const content = response.choices[0]?.message?.content ?? '{}';
    return JSON.parse(content) as T;
  }
}

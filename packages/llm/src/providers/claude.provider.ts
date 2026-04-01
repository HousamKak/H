import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, GenerateParams, GenerateResult, StructuredGenerateParams } from '../types.js';

export class ClaudeProvider implements LLMProvider {
  name = 'Claude';
  type = 'claude' as const;
  private client: Anthropic;
  private defaultModel: string;

  constructor(apiKey?: string, model?: string) {
    this.client = new Anthropic({ apiKey: apiKey ?? process.env.ANTHROPIC_API_KEY });
    this.defaultModel = model ?? 'claude-sonnet-4-20250514';
  }

  async isAvailable(): Promise<boolean> {
    try {
      return !!(process.env.ANTHROPIC_API_KEY || this.client);
    } catch {
      return false;
    }
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const systemMessage = params.messages.find((m) => m.role === 'system');
    const userMessages = params.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const response = await this.client.messages.create({
      model: params.model ?? this.defaultModel,
      max_tokens: params.maxTokens ?? 8192,
      temperature: params.temperature ?? 0.7,
      system: systemMessage?.content ?? '',
      messages: userMessages,
      stop_sequences: params.stopSequences,
    });

    const textContent = response.content.find((c) => c.type === 'text');

    return {
      content: textContent?.text ?? '',
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      finishReason: response.stop_reason === 'end_turn' ? 'end_turn'
        : response.stop_reason === 'max_tokens' ? 'max_tokens'
        : 'unknown',
    };
  }

  async generateStructured<T>(params: StructuredGenerateParams<T>): Promise<T> {
    const schemaInstruction = `\n\nRespond ONLY with valid JSON matching this schema:\n${JSON.stringify(params.schema, null, 2)}\n\nDo not include any text before or after the JSON.`;

    const messages = params.messages.map((m) =>
      m.role === 'system'
        ? { ...m, content: m.content + schemaInstruction }
        : m
    );

    if (!messages.some((m) => m.role === 'system')) {
      messages.unshift({ role: 'system', content: schemaInstruction });
    }

    const result = await this.generate({ ...params, messages });
    const jsonStr = extractJSON(result.content);
    return JSON.parse(jsonStr) as T;
  }
}

function extractJSON(text: string): string {
  // Try to find JSON in markdown code blocks
  const fenced = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenced) return fenced[1].trim();

  // Try raw JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0];

  return text.trim();
}

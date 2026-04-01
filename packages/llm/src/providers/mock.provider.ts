import type { LLMProvider, GenerateParams, GenerateResult, StructuredGenerateParams } from '../types.js';

export class MockProvider implements LLMProvider {
  name = 'Mock';
  type = 'mock' as const;
  private responses: Map<string, string> = new Map();

  async isAvailable(): Promise<boolean> {
    return true;
  }

  setResponse(pattern: string, response: string): void {
    this.responses.set(pattern, response);
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const userMessage = [...params.messages].reverse().find((m) => m.role === 'user');
    const prompt = userMessage?.content ?? '';

    // Check for matching patterns
    for (const [pattern, response] of this.responses) {
      if (prompt.toLowerCase().includes(pattern.toLowerCase())) {
        return mockResult(response);
      }
    }

    return mockResult(`[Mock response to: ${prompt.substring(0, 100)}...]`);
  }

  async generateStructured<T>(params: StructuredGenerateParams<T>): Promise<T> {
    const result = await this.generate(params);
    try {
      return JSON.parse(result.content) as T;
    } catch {
      return {} as T;
    }
  }
}

function mockResult(content: string): GenerateResult {
  return {
    content,
    model: 'mock',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    finishReason: 'end_turn',
  };
}

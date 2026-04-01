import type { ProviderType } from '@h/types';
import type { LLMProvider } from './types.js';
import { ClaudeProvider } from './providers/claude.provider.js';
import { OpenAIProvider } from './providers/openai.provider.js';
import { ClaudeCodeProvider } from './providers/claude-code.provider.js';
import { MockProvider } from './providers/mock.provider.js';

export class ProviderRegistry {
  private providers: Map<ProviderType, LLMProvider> = new Map();
  private defaultProvider: ProviderType;

  constructor(defaultProvider?: ProviderType) {
    this.defaultProvider = defaultProvider ?? 'claude';
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.type, provider);
  }

  get(type?: ProviderType): LLMProvider {
    const providerType = type ?? this.defaultProvider;
    const provider = this.providers.get(providerType);
    if (!provider) {
      throw new Error(`LLM provider '${providerType}' not registered. Available: ${[...this.providers.keys()].join(', ')}`);
    }
    return provider;
  }

  setDefault(type: ProviderType): void {
    if (!this.providers.has(type)) {
      throw new Error(`Cannot set default: provider '${type}' not registered`);
    }
    this.defaultProvider = type;
  }

  listAvailable(): ProviderType[] {
    return [...this.providers.keys()];
  }

  static createDefault(): ProviderRegistry {
    const defaultType = (process.env.H_DEFAULT_LLM_PROVIDER as ProviderType) ?? 'claude';
    const registry = new ProviderRegistry(defaultType);

    if (process.env.ANTHROPIC_API_KEY) {
      registry.register(new ClaudeProvider());
    }
    if (process.env.OPENAI_API_KEY) {
      registry.register(new OpenAIProvider());
    }

    registry.register(new ClaudeCodeProvider());
    registry.register(new MockProvider());

    return registry;
  }
}

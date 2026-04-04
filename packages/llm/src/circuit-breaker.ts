import type { LLMProvider, GenerateParams, GenerateResult } from './types.js';
import type { CircuitState, CircuitBreakerConfig } from '@h/types';

export class CircuitBreaker implements LLMProvider {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;
  private config: CircuitBreakerConfig;

  constructor(
    private provider: LLMProvider,
    config?: Partial<CircuitBreakerConfig>,
  ) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeoutMs: config?.resetTimeoutMs ?? 60_000,
      halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 2,
    };
  }

  get name() {
    return this.provider.name;
  }

  get type() {
    return this.provider.type;
  }

  async isAvailable(): Promise<boolean> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeoutMs) {
        this.state = 'half_open';
        this.halfOpenAttempts = 0;
      } else {
        return false;
      }
    }
    return this.provider.isAvailable();
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeoutMs) {
        this.state = 'half_open';
        this.halfOpenAttempts = 0;
      } else {
        throw new Error(
          `Circuit breaker OPEN for provider ${this.provider.name}. Retry after ${this.config.resetTimeoutMs}ms.`,
        );
      }
    }

    try {
      const result = await this.provider.generate(params);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half_open') {
      this.state = 'closed';
      this.failureCount = 0;
    }
    this.failureCount = Math.max(0, this.failureCount - 1); // gradual recovery
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half_open') {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        this.state = 'open';
      }
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failureCount;
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
  }
}

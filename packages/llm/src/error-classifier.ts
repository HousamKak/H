import type { ClassifiedError } from '@h/types';

export function classifyError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  // Rate limiting
  if (
    lower.includes('rate limit') ||
    lower.includes('429') ||
    lower.includes('too many requests')
  ) {
    const retryMatch = message.match(/retry.after[:\s]*(\d+)/i);
    return {
      category: 'rate_limit',
      message,
      retryable: true,
      retryAfterMs: retryMatch ? parseInt(retryMatch[1]) * 1000 : 30_000,
    };
  }

  // Auth errors
  if (
    lower.includes('unauthorized') ||
    lower.includes('401') ||
    lower.includes('invalid api key') ||
    lower.includes('forbidden') ||
    lower.includes('403')
  ) {
    return { category: 'auth', message, retryable: false };
  }

  // Permanent errors
  if (
    lower.includes('400') ||
    lower.includes('bad request') ||
    lower.includes('not found') ||
    lower.includes('404') ||
    lower.includes('invalid')
  ) {
    return { category: 'permanent', message, retryable: false };
  }

  // Budget / context errors
  if (
    lower.includes('context length') ||
    lower.includes('token limit') ||
    lower.includes('max_tokens') ||
    lower.includes('budget')
  ) {
    return { category: 'budget', message, retryable: false };
  }

  // Transient (timeouts, server errors, network issues)
  if (
    lower.includes('timeout') ||
    lower.includes('500') ||
    lower.includes('502') ||
    lower.includes('503') ||
    lower.includes('504') ||
    lower.includes('econnrefused') ||
    lower.includes('enotfound') ||
    lower.includes('network')
  ) {
    return { category: 'transient', message, retryable: true, retryAfterMs: 5_000 };
  }

  // Default: treat as transient (retry once)
  return { category: 'transient', message, retryable: true, retryAfterMs: 5_000 };
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; initialDelayMs?: number; maxDelayMs?: number } = {},
): Promise<T> {
  const { maxRetries = 3, initialDelayMs = 1000, maxDelayMs = 30_000 } = options;
  let delay = initialDelayMs;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const classified = classifyError(err);
      if (!classified.retryable) throw err;

      const jitter = delay * 0.3 * Math.random();
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
  throw new Error('Unreachable');
}

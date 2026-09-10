import { describe, expect, it } from 'vitest';
import {
  AIError,
  MODEL_FALLBACK_CATEGORIES,
  TRANSIENT_ERROR_CATEGORIES,
} from '../../../../services/ai/core/AIError';

describe('AIError', () => {
  it('exposes the canonical fields and is throwable', () => {
    const err = new AIError({
      category: 'rate-limit',
      provider: 'gemini',
      message: 'too many requests',
      userMessage: 'Espera unos segundos.',
      retryable: true,
      status: 429,
      retryAfterMs: 5000,
      errorCode: 'rate-limit_429',
    });
    expect(err.name).toBe('AIError');
    expect(err.category).toBe('rate-limit');
    expect(err.provider).toBe('gemini');
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.errorCode).toBe('rate-limit_429');
    expect(() => {
      throw err;
    }).toThrowError(/too many requests/);
  });

  it('AIError.is narrows unknown errors', () => {
    const err = new AIError({
      category: 'auth',
      provider: 'gemini',
      message: 'bad key',
      userMessage: 'Revisa la API key.',
      retryable: false,
    });
    expect(AIError.is(err)).toBe(true);
    expect(AIError.is(new Error('plain'))).toBe(false);
    expect(AIError.is('string')).toBe(false);
  });

  it('classifies transient vs model-fallback categories consistently', () => {
    expect(TRANSIENT_ERROR_CATEGORIES.has('overloaded')).toBe(true);
    expect(TRANSIENT_ERROR_CATEGORIES.has('rate-limit')).toBe(true);
    expect(TRANSIENT_ERROR_CATEGORIES.has('auth')).toBe(false);
    expect(MODEL_FALLBACK_CATEGORIES.has('overloaded')).toBe(true);
    expect(MODEL_FALLBACK_CATEGORIES.has('rate-limit')).toBe(true);
    expect(MODEL_FALLBACK_CATEGORIES.has('auth')).toBe(false);
  });
});

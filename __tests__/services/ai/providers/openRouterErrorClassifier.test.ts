import { describe, it, expect } from 'vitest';
import { openRouterErrorClassifier } from '../../../../services/ai/providers/openrouter/openRouterErrorClassifier';
import { AIError } from '../../../../services/ai/core/AIError';

describe('openRouterErrorClassifier', () => {
  it('clasifica 429 como rate-limit retryable', () => {
    const e = openRouterErrorClassifier.classify(new Error('HTTP 429 Too Many Requests'));
    expect(e.category).toBe('rate-limit');
    expect(e.retryable).toBe(true);
  });

  it('clasifica 401 como auth no retryable', () => {
    const e = openRouterErrorClassifier.classify(new Error('HTTP 401 Unauthorized'));
    expect(e.category).toBe('auth');
    expect(e.retryable).toBe(false);
  });

  it('clasifica un error de red genérico como retryable', () => {
    const e = openRouterErrorClassifier.classify(new TypeError('fetch failed'));
    expect(e.retryable).toBe(true);
  });

  it('clasifica 5xx como overloaded retryable (categoría real, no "server")', () => {
    const e = openRouterErrorClassifier.classify(new Error('HTTP 503 Service Unavailable'));
    expect(e.category).toBe('overloaded');
    expect(e.retryable).toBe(true);
  });

  it('marca el provider como openrouter', () => {
    const e = openRouterErrorClassifier.classify(new Error('HTTP 429 Too Many Requests'));
    expect(e.provider).toBe('openrouter');
  });

  it('devuelve el mismo AIError si ya es uno', () => {
    const existing = new AIError({
      category: 'auth',
      provider: 'openrouter',
      message: 'boom',
      userMessage: 'uh',
      retryable: false,
    });
    expect(openRouterErrorClassifier.classify(existing)).toBe(existing);
  });

  it('respeta isRetryable / isModelFallbackCandidate del clasificador base', () => {
    // Network transient → retryable in-model.
    expect(openRouterErrorClassifier.isRetryable(new TypeError('fetch failed'))).toBe(true);
    // isModelFallbackCandidate: fallback para 429 / overloaded, no para red.
    expect(
      openRouterErrorClassifier.isModelFallbackCandidate(new Error('HTTP 429 Too Many Requests')),
    ).toBe(true);
    expect(
      openRouterErrorClassifier.isModelFallbackCandidate(new TypeError('fetch failed')),
    ).toBe(false);
    // El clasificador base excluye rate-limit del retry in-model (por diseño).
    expect(openRouterErrorClassifier.classify(new Error('HTTP 429 Too Many Requests')).retryable).toBe(
      true,
    );
    expect(openRouterErrorClassifier.isRetryable(new Error('HTTP 429 Too Many Requests'))).toBe(false);
  });
});

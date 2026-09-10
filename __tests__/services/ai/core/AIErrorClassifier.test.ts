import { describe, expect, it } from 'vitest';
import {
  AIErrorClassifier,
  geminiErrorClassifier,
} from '../../../../services/ai/errors/AIErrorClassifier';
import { AIError } from '../../../../services/ai/core/AIError';

describe('AIErrorClassifier', () => {
  it('classifies 429 as a retryable rate-limit and reads retry-after', () => {
    const err = geminiErrorClassifier.classify({
      status: 429,
      message: 'Resource exhausted',
      retryAfter: 12,
    });
    expect(err).toBeInstanceOf(AIError);
    expect(err.category).toBe('rate-limit');
    expect(err.retryable).toBe(true);
    expect(err.retryAfterMs).toBe(12_000);
  });

  it('classifies the whole 5xx family as overloaded', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(geminiErrorClassifier.classify({ status }).category).toBe('overloaded');
    }
  });

  it('classifies 401/403 as a non-retryable auth error', () => {
    const err = geminiErrorClassifier.classify({ status: 403, message: 'permission denied' });
    expect(err.category).toBe('auth');
    expect(err.retryable).toBe(false);
  });

  it('classifies 400 as an invalid request', () => {
    expect(geminiErrorClassifier.classify({ status: 400, message: 'bad' }).category).toBe(
      'invalid-request',
    );
  });

  it('classifies malformed JSON and empty responses', () => {
    expect(
      geminiErrorClassifier.classify(new SyntaxError('Unexpected token in JSON')).category,
    ).toBe('malformed-response');
    expect(geminiErrorClassifier.classify(new Error('empty response')).category).toBe(
      'empty-response',
    );
  });

  it('classifies network and timeout failures', () => {
    expect(geminiErrorClassifier.classify(new Error('fetch failed')).category).toBe('network');
    const timeoutErr = new Error('request timed out');
    timeoutErr.name = 'TimeoutError';
    expect(geminiErrorClassifier.classify(timeoutErr).category).toBe('timeout');
  });

  it('extracts an embedded server JSON body from the SDK message', () => {
    const err = geminiErrorClassifier.classify(
      new Error('got status: 503. {"error":{"code":503,"message":"overloaded","status":"UNAVAILABLE"}}'),
    );
    expect(err.category).toBe('overloaded');
    expect(err.status).toBe(503);
  });

  it('treats a caller AbortError as aborted, not a timeout', () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    expect(geminiErrorClassifier.classify(abort).category).toBe('aborted');
  });

  it('isRetryable excludes rate-limit but includes overloaded', () => {
    expect(geminiErrorClassifier.isRetryable({ status: 503 })).toBe(true);
    expect(geminiErrorClassifier.isRetryable({ status: 429 })).toBe(false);
    expect(geminiErrorClassifier.isRetryable({ status: 401 })).toBe(false);
  });

  it('isModelFallbackCandidate covers overload, rate-limit and unknown-model errors', () => {
    expect(geminiErrorClassifier.isModelFallbackCandidate({ status: 503 })).toBe(true);
    expect(geminiErrorClassifier.isModelFallbackCandidate({ status: 429 })).toBe(true);
    expect(
      geminiErrorClassifier.isModelFallbackCandidate({ status: 404, message: 'model not found' }),
    ).toBe(true);
    expect(geminiErrorClassifier.isModelFallbackCandidate({ status: 401 })).toBe(false);
  });

  it('returns AIError instances unchanged', () => {
    const original = new AIError({
      category: 'auth',
      provider: 'gemini',
      message: 'bad key',
      userMessage: 'Revisa la API key.',
      retryable: false,
    });
    expect(geminiErrorClassifier.classify(original)).toBe(original);
  });

  it('stamps the configured provider id', () => {
    const openaiClassifier = new AIErrorClassifier('openai');
    expect(openaiClassifier.classify({ status: 500 }).provider).toBe('openai');
  });
});

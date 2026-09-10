import { describe, expect, it, vi } from 'vitest';
import { AIRetryPolicy } from '../../../../services/ai/retry/AIRetryPolicy';

const instantSleep = async (): Promise<void> => {};
const alwaysRetry = () => true;
const neverRetry = () => false;
const identity = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));

describe('AIRetryPolicy', () => {
  it('returns the value on first success without retrying', async () => {
    const policy = new AIRetryPolicy({ maxRetries: 3, sleep: instantSleep });
    const fn = vi.fn(async () => 'ok');
    const result = await policy.run(fn, { shouldRetry: alwaysRetry, normalizeError: identity });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures with backoff then succeeds', async () => {
    const policy = new AIRetryPolicy({ maxRetries: 3, sleep: instantSleep });
    let attempts = 0;
    const fn = vi.fn(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('overloaded');
      return 'recovered';
    });
    const onRetry = vi.fn();
    const result = await policy.run(fn, {
      shouldRetry: alwaysRetry,
      normalizeError: identity,
      onRetry,
    });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('throws the normalized error immediately when not retryable', async () => {
    const policy = new AIRetryPolicy({ maxRetries: 3, sleep: instantSleep });
    const fn = vi.fn(async () => {
      throw new Error('raw failure');
    });
    const normalizeError = vi.fn(() => new Error('normalized'));
    await expect(
      policy.run(fn, { shouldRetry: neverRetry, normalizeError }),
    ).rejects.toThrowError('normalized');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(normalizeError).toHaveBeenCalledTimes(1);
  });

  it('gives up after exhausting retries and throws the normalized error', async () => {
    const policy = new AIRetryPolicy({ maxRetries: 2, sleep: instantSleep });
    const fn = vi.fn(async () => {
      throw new Error('still failing');
    });
    await expect(
      policy.run(fn, { shouldRetry: alwaysRetry, normalizeError: () => new Error('exhausted') }),
    ).rejects.toThrowError('exhausted');
    // initial attempt + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

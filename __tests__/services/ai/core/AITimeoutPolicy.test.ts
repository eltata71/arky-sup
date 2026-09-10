import { describe, expect, it } from 'vitest';
import {
  AITimeoutPolicy,
  combineAbortSignals,
} from '../../../../services/ai/retry/AITimeoutPolicy';

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('AITimeoutPolicy', () => {
  it('resolves a fast task and forwards a usable signal', async () => {
    const policy = new AITimeoutPolicy(1000);
    let received: AbortSignal | undefined;
    const result = await policy.run(async (signal) => {
      received = signal;
      return 'done';
    });
    expect(result).toBe('done');
    expect(received).toBeInstanceOf(AbortSignal);
    expect(received?.aborted).toBe(false);
  });

  it('aborts the task and throws a TimeoutError when the timer fires', async () => {
    const policy = new AITimeoutPolicy(20);
    await expect(
      policy.run(async (signal) => {
        await wait(200);
        if (signal.aborted) throw new Error('aborted by timer');
        return 'late';
      }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('exposes the abort signal so the SDK call can be torn down', async () => {
    const policy = new AITimeoutPolicy(20);
    let observedAbort = false;
    await expect(
      policy.run(
        (signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              observedAbort = true;
              reject(new Error('socket torn down'));
            });
          }),
      ),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(observedAbort).toBe(true);
  });

  it('combineAbortSignals aborts when either input aborts', () => {
    const a = new AbortController();
    const b = new AbortController();
    const merged = combineAbortSignals(a.signal, b.signal);
    expect(merged.aborted).toBe(false);
    b.abort();
    expect(merged.aborted).toBe(true);
  });

  it('combineAbortSignals short-circuits an already-aborted input', () => {
    const a = new AbortController();
    a.abort();
    const b = new AbortController();
    expect(combineAbortSignals(a.signal, b.signal)).toBe(a.signal);
  });
});

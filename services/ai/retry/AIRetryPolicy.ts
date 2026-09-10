/**
 * AIRetryPolicy — exponential-backoff retry with full jitter.
 *
 * The policy is provider-agnostic: it does not know *which* errors are
 * retryable. Callers inject `shouldRetry` (decide) and `normalizeError`
 * (the error to throw once retries are exhausted). This is the same loop
 * `geminiService` used internally, lifted into the `core` layer so every
 * generation path shares one battle-tested implementation.
 */

export interface AIRetryHooks {
  /** Decide whether `error` warrants another attempt. */
  shouldRetry: (error: unknown) => boolean;
  /** Map a terminal error into the canonical error to throw. */
  normalizeError: (error: unknown) => Error;
  /** Observability hook fired before each backoff wait. */
  onRetry?: (error: unknown, attemptsLeft: number, delayMs: number) => void;
}

export interface AIRetryPolicyOptions {
  /** Max retries after the first attempt (default 2). */
  maxRetries?: number;
  /** Initial backoff delay in ms (default 1200). */
  initialBackoffMs?: number;
  /** Backoff ceiling in ms (default 16000). */
  maxBackoffMs?: number;
  /** Deterministic delay override — used by tests to avoid real waits. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class AIRetryPolicy {
  readonly maxRetries: number;
  readonly initialBackoffMs: number;
  readonly maxBackoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: AIRetryPolicyOptions = {}) {
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.initialBackoffMs = Math.max(0, options.initialBackoffMs ?? 1200);
    this.maxBackoffMs = Math.max(this.initialBackoffMs, options.maxBackoffMs ?? 16_000);
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Run `fn`, retrying transient failures with exponential backoff + jitter.
   * Throws `normalizeError(lastError)` once retries are exhausted or the
   * error is not retryable.
   */
  async run<T>(fn: () => Promise<T>, hooks: AIRetryHooks): Promise<T> {
    return this.attempt(fn, hooks, this.maxRetries, this.initialBackoffMs);
  }

  private async attempt<T>(
    fn: () => Promise<T>,
    hooks: AIRetryHooks,
    retriesLeft: number,
    delay: number,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (retriesLeft <= 0 || !hooks.shouldRetry(error)) {
        throw hooks.normalizeError(error);
      }
      // Full jitter — avoids thundering-herd retries while a model recovers.
      const jittered = Math.min(this.maxBackoffMs, delay) * (0.6 + Math.random() * 0.6);
      hooks.onRetry?.(error, retriesLeft, jittered);
      await this.sleep(jittered);
      return this.attempt(fn, hooks, retriesLeft - 1, Math.min(this.maxBackoffMs, delay * 2));
    }
  }
}

/**
 * AITimeoutPolicy — abortable per-attempt timeout.
 *
 * Unlike a plain `Promise.race`, this ties a fresh `AbortController` to the
 * timeout so the underlying fetch is actually torn down — critical on iOS
 * Safari, where dangling fetches cascade into "Load failed" errors. It also
 * merges an optional caller-provided abort signal so client cancellation and
 * the timeout both reach the SDK.
 */

/** Merge two abort signals into one that aborts when either input aborts. */
export function combineAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a;
  if (b.aborted) return b;
  const controller = new AbortController();
  const onAbortA = () => controller.abort(a.reason);
  const onAbortB = () => controller.abort(b.reason);
  a.addEventListener('abort', onAbortA, { once: true });
  b.addEventListener('abort', onAbortB, { once: true });
  return controller.signal;
}

export interface AITimeoutRunOptions {
  /** Caller-provided abort signal, merged with the timeout signal. */
  externalSignal?: AbortSignal;
  /** Message used for the synthetic timeout error. */
  timeoutMessage?: string;
}

export class AITimeoutPolicy {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    this.timeoutMs = Math.max(1, timeoutMs);
  }

  /**
   * Run `task` with an abortable timeout. `task` receives the (possibly
   * merged) signal and SHOULD forward it to the underlying SDK/fetch call so
   * the socket is torn down on timeout.
   *
   * When *our* timer fires, the signal is aborted AND a synthetic
   * `TimeoutError` is raced in — so even a task that ignores the signal still
   * settles. A caller-driven abort propagates verbatim (it is not misreported
   * as a timeout).
   */
  async run<T>(
    task: (signal: AbortSignal) => Promise<T>,
    options: AITimeoutRunOptions = {},
  ): Promise<T> {
    const controller = new AbortController();
    const signal = options.externalSignal
      ? combineAbortSignals(controller.signal, options.externalSignal)
      : controller.signal;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const timeoutError = new Error(options.timeoutMessage ?? 'AI request timed out.');
        timeoutError.name = 'TimeoutError';
        reject(timeoutError);
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([task(signal), timeout]);
    } catch (err) {
      // Our timer caused the abort — normalise to a TimeoutError regardless of
      // how the task surfaced the cancellation.
      if (controller.signal.aborted) {
        const timeoutError = new Error(options.timeoutMessage ?? 'AI request timed out.');
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

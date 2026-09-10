/**
 * The legacy model-fallback loop.
 *
 * This is the loop `geminiService` ran inside its own class before the AI layer
 * existed, lifted verbatim so both paths share one implementation of "retry,
 * time out, then try the next model". It stays separate from
 * `AIRequestExecutor.runAttempts` on purpose: that one walks a planned route
 * across backends and enforces capabilities, and this one takes the caller's
 * error predicates and knows nothing about providers at all.
 *
 * It is the strangler seam, not a second executor. When the last legacy call
 * site declares a canonical `AIRequest`, this file goes.
 */

import { AIRetryPolicy } from '../retry/AIRetryPolicy';
import { AITimeoutPolicy } from '../retry/AITimeoutPolicy';

export interface RunWithModelFallbackOptions<T> {
  /** Primary model id tried first. */
  preferredModel: string;
  /** Ordered fallback models tried after the primary (already excludes it). */
  fallbackChain: readonly string[];
  /** Single-attempt worker — receives the model id and the abort signal. */
  attempt: (modelId: string, signal: AbortSignal) => Promise<T>;
  /** Retry policy applied within each model. */
  retryPolicy: AIRetryPolicy;
  /** Per-attempt timeout in ms. */
  timeoutMs: number;
  /** Decide whether an error warrants an in-model retry. */
  shouldRetry: (error: unknown) => boolean;
  /** Map a terminal error into the canonical error to throw. */
  normalizeError: (error: unknown) => Error;
  /** Decide whether to advance to the next model in the chain. */
  isModelFallbackCandidate: (error: unknown) => boolean;
  /** Hard cap on the number of models tried. */
  maxCandidates?: number;
  /** Caller abort signal. */
  signal?: AbortSignal;
  /** Synthetic timeout message. */
  timeoutMessage?: string;
  /** Fired before each attempt with the model id and its chain index. */
  onModelSelected?: (modelId: string, index: number) => void;
  /** Fired before each backoff wait. */
  onRetry?: (error: unknown, attemptsLeft: number, delayMs: number) => void;
}

/** Retry + timeout + model-fallback, with every decision injected. */
export async function runWithModelFallback<T>(
  options: RunWithModelFallbackOptions<T>,
): Promise<T> {
  const candidates = [
    options.preferredModel,
    ...options.fallbackChain.filter((m) => m !== options.preferredModel),
  ].slice(0, options.maxCandidates ?? Number.POSITIVE_INFINITY);

  let lastError: unknown = null;

  for (let index = 0; index < candidates.length; index += 1) {
    const model = candidates[index];
    if (options.signal?.aborted) {
      throw new DOMException('AI request aborted before model attempt', 'AbortError');
    }
    options.onModelSelected?.(model, index);
    try {
      return await options.retryPolicy.run(
        () => {
          const timeoutPolicy = new AITimeoutPolicy(options.timeoutMs);
          return timeoutPolicy.run((signal) => options.attempt(model, signal), {
            externalSignal: options.signal,
            timeoutMessage: options.timeoutMessage ?? 'AI generation timed out.',
          });
        },
        {
          shouldRetry: options.shouldRetry,
          normalizeError: options.normalizeError,
          onRetry: options.onRetry,
        },
      );
    } catch (error) {
      lastError = error;
      if (!options.isModelFallbackCandidate(error)) throw error;
    }
  }

  throw lastError ?? new Error('No AI model available for generation.');
}

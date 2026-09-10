/**
 * What to do about a failure, decided from the *canonical* error.
 *
 * `AIRequestExecutor` used to take an `AIErrorClassifier` in its constructor
 * and default it to `geminiErrorClassifier` — on the path documented as
 * "provider-driven". Every failure from every backend was therefore stamped
 * `provider: 'gemini'`, and the retry decision was made by heuristics scoped to
 * Google's SDK. `AIProvider.classifyError` existed the whole time and was
 * called by nobody.
 *
 * The split this module makes is the one the contract already implied:
 *
 *  - **Classification is the provider's job.** Only the adapter knows what its
 *    backend's errors look like, and it is the only thing that can honestly
 *    stamp `AIError.provider`.
 *  - **The decision is not.** "Retry, try another model, try another backend,
 *    give up" is policy over the canonical `AIErrorCategory`, identical for
 *    every backend. Duplicating it per provider would be three chances to
 *    disagree about whether a 429 is worth retrying.
 */

import {
  AIError,
  MODEL_FALLBACK_CATEGORIES,
  TRANSIENT_ERROR_CATEGORIES,
  type AIErrorCategory,
} from '../core/AIError';
import { readErrorShape } from './AIErrorClassifier';

/**
 * True when retrying the *same* model could plausibly succeed.
 *
 * Rate-limit is excluded on purpose: hammering a shared per-key quota only
 * deepens the throttle. It is still a fallback candidate below, because a
 * different model usually has its own budget.
 */
export function isRetryableError(error: AIError): boolean {
  return TRANSIENT_ERROR_CATEGORIES.has(error.category) && error.category !== 'rate-limit';
}

/**
 * True when the next *model* in the chain deserves a try.
 *
 * The raw error is consulted as well as the category because "this model does
 * not exist here" arrives as a 404 or as prose, and both classify as
 * `invalid-request` or `unknown` while meaning something very specific: try a
 * different model, not a different prompt.
 */
export function isModelFallbackCandidate(error: AIError, raw?: unknown): boolean {
  if (MODEL_FALLBACK_CATEGORIES.has(error.category)) return true;
  const { status, message } = readErrorShape(raw ?? error.cause ?? error);
  const lower = (message ?? '').toLowerCase();
  return (
    status === 404 ||
    lower.includes('not found') ||
    lower.includes('unsupported') ||
    lower.includes('invalid model') ||
    lower.includes('unknown model')
  );
}

/**
 * Categories that justify trying a different *backend*.
 *
 * Deliberately wider than the model set in one respect and narrower in another.
 * Wider: `configuration` and `auth` belong here — a missing or rejected key is
 * fatal for this vendor and says nothing about the next one, and it is exactly
 * the case where switching backends turns a hard failure into an answer.
 * Narrower: `invalid-request` does not. A malformed request is malformed
 * everywhere, and retrying it against a second vendor spends money to receive
 * the same 400 from someone else.
 */
const PROVIDER_FALLBACK_CATEGORIES: ReadonlySet<AIErrorCategory> = new Set<AIErrorCategory>([
  'overloaded',
  'rate-limit',
  'network',
  'timeout',
  'auth',
  'configuration',
  'sdk',
]);

/** True when the next *backend* in the plan deserves a try. */
export function isProviderFallbackCandidate(error: AIError): boolean {
  return PROVIDER_FALLBACK_CATEGORIES.has(error.category);
}

/**
 * True when the failure says something about the backend's health.
 *
 * Our own mistakes must not open a circuit against a vendor: an aborted
 * request, a prompt this app refused to send, a schema it could not build and a
 * 400 it produced are all facts about this repository. Counting them would take
 * a healthy provider out of the ranking because of a bug here.
 */
export function reflectsProviderHealth(error: AIError): boolean {
  return (
    error.category !== 'aborted' &&
    error.category !== 'invalid-request' &&
    error.category !== 'configuration'
  );
}

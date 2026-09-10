/**
 * Provider health — a circuit breaker per backend.
 *
 * Retry and model fallback both assume the next attempt has a chance. Against a
 * backend that is down, neither does: a 503 on `claude-opus` is followed by a
 * 503 on `claude-sonnet` a second later, and the user waits out the whole chain
 * to be told what the first failure already said. Worse, a rate-limited key
 * gets hammered by exactly the traffic that is being throttled.
 *
 * So failures are counted. After `FAILURE_THRESHOLD` consecutive ones the
 * circuit opens and the backend stops being ranked first; after `COOLDOWN_MS`
 * it goes half-open and one request is allowed through to find out whether the
 * outage is over. A success closes it.
 *
 * Two deliberate limits:
 *
 *  - **An open circuit deprioritises, it does not exclude.** If the degraded
 *    backend is the only one that can serve a required capability, refusing to
 *    try it turns a probably-failing request into a certainly-failing one. It
 *    goes last instead of first.
 *  - **State is per browser tab and dies with it.** This is a frontend-first
 *    app with no server of its own to hold shared health, and inventing a
 *    persisted one would make a stale record outlive the outage it described.
 */

import type { AIProviderId } from '../core/AIModel';

/** Consecutive failures that open the circuit. */
export const FAILURE_THRESHOLD = 3;
/** How long an open circuit waits before allowing one probe through. */
export const COOLDOWN_MS = 60_000;

export type CircuitState = 'closed' | 'open' | 'half-open';

interface HealthRecord {
  consecutiveFailures: number;
  openedAt?: number;
  lastFailureAt?: number;
  successes: number;
  failures: number;
}

const records = new Map<AIProviderId, HealthRecord>();

function recordFor(provider: AIProviderId): HealthRecord {
  const existing = records.get(provider);
  if (existing) return existing;
  const fresh: HealthRecord = { consecutiveFailures: 0, successes: 0, failures: 0 };
  records.set(provider, fresh);
  return fresh;
}

/** Note that a request against this backend succeeded. */
export function recordProviderSuccess(provider: AIProviderId): void {
  const record = recordFor(provider);
  record.consecutiveFailures = 0;
  record.openedAt = undefined;
  record.successes += 1;
}

/**
 * Note that a request against this backend failed in a way that says something
 * about the backend.
 *
 * A caller-side failure — an aborted request, a prompt we refused to send, a
 * schema we could not build — says nothing about the provider's health, so
 * only the executor's transport-level failures reach here. Counting our own
 * mistakes against a vendor is how a circuit opens on a bug in this repository.
 */
export function recordProviderFailure(provider: AIProviderId, now = Date.now()): void {
  const record = recordFor(provider);
  record.consecutiveFailures += 1;
  record.failures += 1;
  record.lastFailureAt = now;
  if (record.consecutiveFailures >= FAILURE_THRESHOLD && record.openedAt === undefined) {
    record.openedAt = now;
  }
}

/** Current circuit state for a backend. */
export function providerCircuitState(provider: AIProviderId, now = Date.now()): CircuitState {
  const record = records.get(provider);
  if (!record || record.openedAt === undefined) return 'closed';
  return now - record.openedAt >= COOLDOWN_MS ? 'half-open' : 'open';
}

/**
 * Health as a 0..1 multiplier the ranker can multiply into a score.
 *
 * Continuous rather than boolean so a backend that failed once ranks below a
 * clean one without being taken out of the running — which is the difference
 * between reacting to a blip and reacting to an outage.
 */
export function providerHealthScore(provider: AIProviderId, now = Date.now()): number {
  const state = providerCircuitState(provider, now);
  if (state === 'open') return 0;
  if (state === 'half-open') return 0.5;
  const record = records.get(provider);
  if (!record || record.consecutiveFailures === 0) return 1;
  return Math.max(0.25, 1 - record.consecutiveFailures / FAILURE_THRESHOLD);
}

/** Counters for the diagnostics panel. */
export function providerHealthSnapshot(
  provider: AIProviderId,
  now = Date.now(),
): { state: CircuitState; successes: number; failures: number; consecutiveFailures: number } {
  const record = records.get(provider);
  return {
    state: providerCircuitState(provider, now),
    successes: record?.successes ?? 0,
    failures: record?.failures ?? 0,
    consecutiveFailures: record?.consecutiveFailures ?? 0,
  };
}

/** Reset all health state. Tests own this; production never calls it. */
export function resetProviderHealth(): void {
  records.clear();
}

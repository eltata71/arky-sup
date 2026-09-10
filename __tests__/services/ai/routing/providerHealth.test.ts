/**
 * The circuit breaker. Its job is to stop the retry/fallback machinery from
 * walking a whole chain against a backend that is down — a 503 on the primary
 * model is followed by a 503 on the fallback a second later, and the user waits
 * out the sequence to be told what the first failure already said.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  COOLDOWN_MS,
  FAILURE_THRESHOLD,
  providerCircuitState,
  providerHealthScore,
  providerHealthSnapshot,
  recordProviderFailure,
  recordProviderSuccess,
  resetProviderHealth,
} from '../../../../services/ai/routing/providerHealth';

const T = 10_000;

beforeEach(() => {
  resetProviderHealth();
});

describe('providerHealth', () => {
  it('starts closed and fully healthy for a backend nobody has called', () => {
    expect(providerCircuitState('gemini', T)).toBe('closed');
    expect(providerHealthScore('gemini', T)).toBe(1);
  });

  it('opens after the threshold of consecutive failures', () => {
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i += 1) recordProviderFailure('gemini', T);
    expect(providerCircuitState('gemini', T)).toBe('closed');
    recordProviderFailure('gemini', T);
    expect(providerCircuitState('gemini', T)).toBe('open');
    expect(providerHealthScore('gemini', T)).toBe(0);
  });

  it('degrades the score before it opens, so a blip reorders instead of excluding', () => {
    recordProviderFailure('gemini', T);
    const score = providerHealthScore('gemini', T);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('goes half-open after the cooldown so one probe can find out', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) recordProviderFailure('gemini', T);
    expect(providerCircuitState('gemini', T + COOLDOWN_MS - 1)).toBe('open');
    expect(providerCircuitState('gemini', T + COOLDOWN_MS)).toBe('half-open');
    expect(providerHealthScore('gemini', T + COOLDOWN_MS)).toBe(0.5);
  });

  it('closes on a success and forgets the streak', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) recordProviderFailure('gemini', T);
    recordProviderSuccess('gemini');
    expect(providerCircuitState('gemini', T)).toBe('closed');
    expect(providerHealthScore('gemini', T)).toBe(1);
  });

  it('keeps each backend’s state to itself', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) recordProviderFailure('gemini', T);
    expect(providerCircuitState('openrouter', T)).toBe('closed');
  });

  it('reports counters for the diagnostics panel', () => {
    recordProviderSuccess('anthropic');
    recordProviderFailure('anthropic', T);
    expect(providerHealthSnapshot('anthropic', T)).toEqual({
      state: 'closed',
      successes: 1,
      failures: 1,
      consecutiveFailures: 1,
    });
  });
});

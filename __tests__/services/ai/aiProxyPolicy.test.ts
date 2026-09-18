/**
 * Specs for the proxy enforcement policy.
 *
 * Two guarantees are load-bearing and pull in opposite directions, so both are
 * asserted here rather than left to the reader:
 *
 *  1. **With `VITE_AI_STRICT_PROXY` unset, nothing changes.** The flag is off
 *     by default and every existing deployment keeps degrading to the direct
 *     provider exactly as before. A regression here is an outage.
 *  2. **With it set, no failure reaches the provider from the browser** — with
 *     the single exception of a key the user supplied themselves. A regression
 *     here is the credential leak the policy exists to close, and it would be
 *     silent, which is why the negatives are spelled out one by one.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../firebase', () => ({ auth: { currentUser: null } }));

import {
  AiProxyEnforcementError,
  classifyProxyStatus,
  decideFallback,
  describeProxyFailure,
  isProxyFailure,
  isProxySuccess,
  isStrictProxyEnforced,
  parseRetryAfterMs,
  proxyFailure,
  proxySuccess,
  rateLimitOrigin,
  type AiProxyFailureReason,
} from '../../../services/ai/aiProxyPolicy';

const env = import.meta.env as Record<string, unknown>;

const setStrict = (value: string | undefined) => {
  if (value === undefined) delete env.VITE_AI_STRICT_PROXY;
  else env.VITE_AI_STRICT_PROXY = value;
};

const ALL_REASONS: AiProxyFailureReason[] = [
  'not-configured',
  'unauthenticated',
  'rate-limited',
  'provider-error',
  'network',
  'malformed',
  'unsupported-request',
];

beforeEach(() => setStrict(undefined));
afterEach(() => setStrict(undefined));

describe('isStrictProxyEnforced', () => {
  it('is false unless the flag is exactly "true"', () => {
    expect(isStrictProxyEnforced()).toBe(false);
    for (const value of ['', 'false', 'TRUE', '1', 'yes', 'true ']) {
      setStrict(value);
      expect(isStrictProxyEnforced()).toBe(false);
    }
  });

  it('is true for "true"', () => {
    setStrict('true');
    expect(isStrictProxyEnforced()).toBe(true);
  });
});

describe('decideFallback — enforcement off (the default)', () => {
  it('allows the direct path for every failure reason, with or without BYOK', () => {
    for (const reason of ALL_REASONS) {
      for (const byokConsented of [true, false]) {
        expect(decideFallback(proxyFailure(reason), { byokConsented })).toBe('direct');
      }
    }
  });
});

describe('decideFallback — enforcement on', () => {
  beforeEach(() => setStrict('true'));

  it('refuses the direct path for every failure reason when the user has no key of their own', () => {
    for (const reason of ALL_REASONS) {
      expect(decideFallback(proxyFailure(reason), { byokConsented: false })).toBe('fail-closed');
    }
  });

  it('allows the direct path only for a consented BYOK call', () => {
    for (const reason of ALL_REASONS) {
      expect(decideFallback(proxyFailure(reason), { byokConsented: true })).toBe('direct');
    }
  });
});

describe('failure classification', () => {
  it('maps auth, throttling and everything else apart', () => {
    expect(classifyProxyStatus(401)).toBe('unauthenticated');
    expect(classifyProxyStatus(403)).toBe('unauthenticated');
    expect(classifyProxyStatus(429)).toBe('rate-limited');
    expect(classifyProxyStatus(500)).toBe('provider-error');
    expect(classifyProxyStatus(502)).toBe('provider-error');
    expect(classifyProxyStatus(400)).toBe('provider-error');
  });

  it('marks throttling, network and provider faults retryable but never a rejected identity', () => {
    expect(proxyFailure('rate-limited').retryable).toBe(true);
    expect(proxyFailure('network').retryable).toBe(true);
    expect(proxyFailure('provider-error').retryable).toBe(true);
    // Repeating the request will not make an invalid token valid.
    expect(proxyFailure('unauthenticated').retryable).toBe(false);
    expect(proxyFailure('not-configured').retryable).toBe(false);
    expect(proxyFailure('unsupported-request').retryable).toBe(false);
  });

  it('lets an explicit retryable override win', () => {
    expect(proxyFailure('malformed', { retryable: true }).retryable).toBe(true);
  });
});

describe('parseRetryAfterMs', () => {
  it('reads a seconds value', () => {
    expect(parseRetryAfterMs('30')).toBe(30_000);
    expect(parseRetryAfterMs(' 1.5 ')).toBe(1_500);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('reads an HTTP date as a delay from now', () => {
    const tenSeconds = new Date(Date.now() + 10_000).toUTCString();
    const parsed = parseRetryAfterMs(tenSeconds);
    expect(parsed).toBeGreaterThan(8_000);
    expect(parsed).toBeLessThanOrEqual(10_000);
  });

  it('never returns a negative delay for a date already past', () => {
    expect(parseRetryAfterMs(new Date(Date.now() - 60_000).toUTCString())).toBe(0);
  });

  it('is undefined when absent or unparseable', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs('')).toBeUndefined();
    expect(parseRetryAfterMs('soon')).toBeUndefined();
  });
});

describe('outcome guards', () => {
  it('narrow success and failure apart', () => {
    const ok = proxySuccess('texto');
    const bad = proxyFailure('network');
    expect(isProxySuccess(ok)).toBe(true);
    expect(isProxyFailure(ok)).toBe(false);
    expect(isProxySuccess(bad)).toBe(false);
    expect(isProxyFailure(bad)).toBe(true);
  });
});

describe('AiProxyEnforcementError', () => {
  it('carries the failure and mirrors its retryability as recoverability', () => {
    const error = new AiProxyEnforcementError(proxyFailure('rate-limited', { status: 429 }));
    expect(error.name).toBe('AiProxyEnforcementError');
    expect(error.failure.reason).toBe('rate-limited');
    expect(error.failure.status).toBe(429);
    expect(error.recoverable).toBe(true);
    expect(new AiProxyEnforcementError(proxyFailure('unauthenticated')).recoverable).toBe(false);
  });

  it('explains every reason in the UI language, distinctly', () => {
    const messages = ALL_REASONS.map((reason) => describeProxyFailure(proxyFailure(reason)));
    for (const message of messages) expect(message.length).toBeGreaterThan(20);
    // A shared message would leave the user unable to tell "log back in" from
    // "this deployment is misconfigured".
    expect(new Set(messages).size).toBe(ALL_REASONS.length);
  });
});

describe('rateLimitOrigin', () => {
  it('names the proxy when the envelope says proxy_rate_limited', () => {
    expect(rateLimitOrigin(proxyFailure('rate-limited', { serverCode: 'proxy_rate_limited' })))
      .toBe('proxy');
  });

  it('names the provider when the envelope says provider_rate_limited', () => {
    expect(rateLimitOrigin(proxyFailure('rate-limited', { serverCode: 'provider_rate_limited' })))
      .toBe('provider');
  });

  it('answers unknown rather than guessing when the code is absent', () => {
    expect(rateLimitOrigin(proxyFailure('rate-limited', {}))).toBe('unknown');
  });

  it('is unknown for anything that is not a rate limit', () => {
    expect(rateLimitOrigin(proxyFailure('network', { serverCode: 'proxy_rate_limited' })))
      .toBe('unknown');
  });
});

describe('describeProxyFailure distinguishes the two 429s', () => {
  it('tells the user to wait when the proxy throttled the session', () => {
    const message = describeProxyFailure(
      proxyFailure('rate-limited', { serverCode: 'proxy_rate_limited' }),
    );
    expect(message).toContain('esta sesión');
    expect(message).toContain('Espere unos segundos');
  });

  it('tells the user the provider quota ran out, and offers the way through', () => {
    const message = describeProxyFailure(
      proxyFailure('rate-limited', { serverCode: 'provider_rate_limited' }),
    );
    expect(message).toContain('cuota');
    expect(message).toContain('Ajustes');
    // Esperar «unos segundos» era el consejo equivocado exactamente aquí.
    expect(message).not.toContain('Espere unos segundos');
  });

  it('says the origin was not identified rather than implying one', () => {
    const message = describeProxyFailure(proxyFailure('rate-limited', {}));
    expect(message).toContain('no quedó identificado');
  });
});

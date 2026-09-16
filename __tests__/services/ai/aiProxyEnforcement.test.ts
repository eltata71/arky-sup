/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
/**
 * Specs for BYOK consent and the enforcement seam.
 *
 * The subtle case, and the reason `byokConsent` is its own module: both key
 * resolvers in the app fall back to the *global* key when the user selected
 * "my own key" but never stored one. Treating that preference alone as consent
 * would authorise the direct call that spends the operator's credential —
 * approving precisely the leak the policy exists to stop.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../firebase', () => ({ auth: { currentUser: null } }));

const reportError = vi.fn();
vi.mock('../../../services/observability', () => ({
  observabilityService: { reportError: (...args: unknown[]) => reportError(...args) },
}));

import { hasConsentedByok } from '../../../services/ai/byokConsent';
import {
  assertDirectCallAllowed,
  assertDirectCallAllowedFor,
} from '../../../services/ai/aiProxyEnforcement';
import { AiProxyEnforcementError, proxyFailure } from '../../../services/ai/aiProxyPolicy';
import type { Settings } from '../../../types';

const env = import.meta.env as Record<string, unknown>;
const setStrict = (value: string | undefined) => {
  if (value === undefined) delete env.VITE_AI_STRICT_PROXY;
  else env.VITE_AI_STRICT_PROXY = value;
};

const settingsWith = (overrides: Partial<Settings['aiConfig']>): Settings => ({
  theme: 'light',
  language: 'es',
  aiConfig: {
    model: 'gemini-2.5-flash',
    provider: 'gemini',
    temperature: 0.4,
    tone: 'neutral',
    languageStyle: 'formal',
    apiKeySource: 'global',
    ...overrides,
  },
} as Settings);

beforeEach(() => {
  reportError.mockClear();
  setStrict(undefined);
  localStorage.clear();
});

afterEach(() => {
  setStrict(undefined);
  localStorage.clear();
});

describe('hasConsentedByok', () => {
  it('is false when the user prefers the global key', () => {
    localStorage.setItem('user_gemini_key', 'a-real-user-key');
    expect(hasConsentedByok(settingsWith({ apiKeySource: 'global' }))).toBe(false);
  });

  it('is false when the preference says "user" but no key was ever stored', () => {
    // Both resolvers silently fall back to the operator's key here. Calling
    // this consent would authorise spending a credential the user never saw.
    expect(hasConsentedByok(settingsWith({ apiKeySource: 'user' }))).toBe(false);
  });

  it('is false when the stored key is blank', () => {
    localStorage.setItem('user_gemini_key', '   ');
    expect(hasConsentedByok(settingsWith({ apiKeySource: 'user' }))).toBe(false);
  });

  it('is true when the user chose their own key and stored one', () => {
    localStorage.setItem('user_gemini_key', 'a-real-user-key');
    expect(hasConsentedByok(settingsWith({ apiKeySource: 'user' }))).toBe(true);
  });

  it('reads the key slot of the provider the request would use', () => {
    localStorage.setItem('user_gemini_key', 'a-gemini-key');
    // An OpenRouter request is not consented by a Gemini key.
    expect(hasConsentedByok(settingsWith({ apiKeySource: 'user', provider: 'openrouter' }))).toBe(false);
    localStorage.setItem('user_openrouter_key', 'an-openrouter-key');
    expect(hasConsentedByok(settingsWith({ apiKeySource: 'user', provider: 'openrouter' }))).toBe(true);
  });

  it('recognizes a stored Anthropic key as BYOK for Anthropic requests', () => {
    localStorage.setItem('user_anthropic_key', 'an-anthropic-key');
    expect(hasConsentedByok(settingsWith({ apiKeySource: 'user', provider: 'anthropic' }))).toBe(true);
  });

  it('is false for undefined settings', () => {
    expect(hasConsentedByok(undefined)).toBe(false);
  });
});

describe('assertDirectCallAllowed — enforcement off', () => {
  it('is a no-op and records nothing', () => {
    expect(() => assertDirectCallAllowed(settingsWith({}), proxyFailure('network'))).not.toThrow();
    expect(() => assertDirectCallAllowedFor(settingsWith({}), 'not-configured')).not.toThrow();
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe('assertDirectCallAllowed — enforcement on', () => {
  beforeEach(() => setStrict('true'));

  it('throws a typed error instead of letting the call reach the provider', () => {
    expect(() => assertDirectCallAllowed(settingsWith({}), proxyFailure('rate-limited', { status: 429 })))
      .toThrow(AiProxyEnforcementError);
  });

  it('records the refusal so a blocked deployment is visible, not just silent', () => {
    try {
      assertDirectCallAllowedFor(settingsWith({}), 'not-configured');
    } catch {
      // expected
    }
    expect(reportError).toHaveBeenCalledTimes(1);
    const [, input] = reportError.mock.calls[0] as [unknown, Record<string, any>];
    expect(input.operationName).toBe('ai.proxy.enforcement');
    expect(input.userVisible).toBe(true);
    expect(input.metadata.reason).toBe('not-configured');
    expect(input.metadata.strictProxy).toBe(true);
  });

  it('grades a retryable failure as a warning and a permanent one as an error', () => {
    try { assertDirectCallAllowed(settingsWith({}), proxyFailure('rate-limited')); } catch { /* expected */ }
    expect((reportError.mock.calls[0][1] as any).severity).toBe('warning');

    reportError.mockClear();
    try { assertDirectCallAllowed(settingsWith({}), proxyFailure('unauthenticated')); } catch { /* expected */ }
    expect((reportError.mock.calls[0][1] as any).severity).toBe('error');
  });

  it('lets a consented BYOK call through untouched', () => {
    localStorage.setItem('user_gemini_key', 'a-real-user-key');
    const settings = settingsWith({ apiKeySource: 'user' });
    expect(() => assertDirectCallAllowed(settings, proxyFailure('network'))).not.toThrow();
    expect(reportError).not.toHaveBeenCalled();
  });

  it('still refuses when the BYOK preference is set but no key is stored', () => {
    expect(() => assertDirectCallAllowed(settingsWith({ apiKeySource: 'user' }), proxyFailure('network')))
      .toThrow(AiProxyEnforcementError);
  });
});

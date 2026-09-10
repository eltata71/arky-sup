/**
 * Routing is two stages and the separation is the property under test:
 * eligibility is absolute, ranking is comparative, and a missing **required**
 * capability can never be outranked by a preference.
 *
 * The behaviour these replace is `AIProviderFactory.createForCapability`, which
 * returned "the first registered provider whose boolean is true" in
 * registration order — a lookup that could not express health, preference,
 * policy or a request's own requirements.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  NoEligibleRouteError,
  planRoute,
  type RoutePlanInput,
} from '../../../../services/ai/routing/routePlanner';
import { planAttempts } from '../../../../services/ai/routing/routeTypes';
import {
  FAILURE_THRESHOLD,
  recordProviderFailure,
  resetProviderHealth,
} from '../../../../services/ai/routing/providerHealth';
import {
  NO_CAPABILITIES,
  type AIProviderCapabilities,
  type AIRequiredCapability,
} from '../../../../services/ai/core/AICapabilities';
import type { AIProviderId } from '../../../../services/ai/core/AIModel';
import type { Settings } from '../../../../types';

const FULL: AIProviderCapabilities = {
  streaming: true,
  structuredOutput: true,
  tools: true,
  images: true,
  files: true,
  audio: true,
};

const TEXT_ONLY: AIProviderCapabilities = { ...NO_CAPABILITIES, streaming: true };

const settingsFor = (provider: AIProviderId, model = ''): Settings =>
  ({
    theme: 'dark',
    language: 'es',
    globalContext: [],
    aiConfig: { provider, model, temperature: 0.7 },
  }) as unknown as Settings;

const caps = (
  entries: ReadonlyArray<[AIProviderId, AIProviderCapabilities]>,
): ReadonlyMap<AIProviderId, AIProviderCapabilities> => new Map(entries);

const input = (over: Partial<RoutePlanInput> = {}): RoutePlanInput => ({
  tier: 'default',
  required: [],
  settings: settingsFor('gemini'),
  allowModelFallback: false,
  allowProviderFallback: false,
  capabilities: caps([
    ['gemini', FULL],
    ['openrouter', FULL],
    ['anthropic', FULL],
  ]),
  now: 1_000,
  ...over,
});

const needs = (
  capability: AIRequiredCapability['capability'],
  level: AIRequiredCapability['level'] = 'required',
): AIRequiredCapability[] => [{ capability, level }];

beforeEach(() => {
  resetProviderHealth();
});

describe('planRoute · eligibility', () => {
  it('starts with the configured provider when it can serve the request', () => {
    const plan = planRoute(input({ settings: settingsFor('anthropic') }));
    expect(plan.primary.provider).toBe('anthropic');
    expect(plan.decision.reroutedForCapability).toBe(false);
  });

  it('excludes a backend that cannot serve a required capability', () => {
    const plan = planRoute(
      input({
        settings: settingsFor('anthropic'),
        required: needs('images'),
        capabilities: caps([
          ['gemini', FULL],
          ['anthropic', { ...FULL, images: false }],
        ]),
      }),
    );
    expect(plan.primary.provider).toBe('gemini');
    expect(plan.decision.reroutedForCapability).toBe(true);
    expect(plan.decision.rejected).toEqual([
      expect.objectContaining({ provider: 'anthropic', reason: 'missing-required-capability' }),
    ]);
  });

  /**
   * The load-bearing one. A `required` capability is a filter, not a penalty,
   * so no amount of preference weight can promote a backend that cannot serve
   * it — which is precisely what a single blended score would allow.
   */
  it('never lets the configured provider outrank a required capability', () => {
    const plan = planRoute(
      input({
        settings: settingsFor('openrouter'),
        required: needs('tools'),
        capabilities: caps([
          ['gemini', FULL],
          ['openrouter', { ...FULL, tools: false }],
        ]),
      }),
    );
    expect(plan.primary.provider).toBe('gemini');
  });

  it('honours an organisation allow-list', () => {
    const plan = planRoute(
      input({ settings: settingsFor('gemini'), allowedProviders: ['anthropic'] }),
    );
    expect(plan.primary.provider).toBe('anthropic');
    expect(plan.decision.rejected).toContainEqual(
      expect.objectContaining({ provider: 'gemini', reason: 'provider-not-allowed' }),
    );
  });

  it('throws with the rejections attached when nothing is eligible', () => {
    expect(() =>
      planRoute(
        input({
          required: needs('audio'),
          capabilities: caps([
            ['gemini', TEXT_ONLY],
            ['openrouter', TEXT_ONLY],
          ]),
        }),
      ),
    ).toThrowError(NoEligibleRouteError);

    try {
      planRoute(
        input({
          required: needs('audio'),
          capabilities: caps([['gemini', TEXT_ONLY]]),
        }),
      );
    } catch (error) {
      expect((error as NoEligibleRouteError).rejected).toHaveLength(1);
      expect((error as NoEligibleRouteError).required).toEqual(needs('audio'));
    }
  });
});

describe('planRoute · ranking', () => {
  it('is deterministic — the same inputs give the same order', () => {
    const first = planRoute(input());
    const second = planRoute(input());
    expect(second.decision.considered.map((c) => c.provider)).toEqual(
      first.decision.considered.map((c) => c.provider),
    );
  });

  it('records every contribution so a total can be read rather than trusted', () => {
    const plan = planRoute(input());
    const top = plan.decision.considered[0];
    expect(top.factors).toHaveProperty('configuredProvider');
    expect(top.factors).toHaveProperty('health');
    expect(Object.values(top.factors).reduce((a, b) => a + b, 0)).toBeCloseTo(top.score);
  });

  it('ranks a degraded backend below a healthy one', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) recordProviderFailure('openrouter', 1_000);
    const plan = planRoute(input({ settings: settingsFor('gemini'), now: 1_000 }));
    const order = plan.decision.considered.map((c) => c.provider);
    expect(order.indexOf('openrouter')).toBeGreaterThan(order.indexOf('anthropic'));
  });

  /**
   * Health reorders the alternatives; it does not abandon the user's choice.
   * Silently switching vendor because of a blip would change who processes the
   * data on the strength of one 503.
   */
  it('keeps the configured provider first even when it has failed recently', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i += 1) recordProviderFailure('gemini', 1_000);
    const plan = planRoute(input({ settings: settingsFor('gemini'), now: 1_000 }));
    expect(plan.primary.provider).toBe('gemini');
  });

  it('prefers a backend that serves a `preferred` capability the others cannot', () => {
    const plan = planRoute(
      input({
        settings: settingsFor('mock' as AIProviderId),
        required: needs('images', 'preferred'),
        capabilities: caps([
          ['openrouter', { ...FULL, images: false }],
          ['anthropic', FULL],
        ]),
      }),
    );
    expect(plan.primary.provider).toBe('anthropic');
  });
});

describe('planRoute · fallback policy', () => {
  it('adds no fallbacks when both policies are off', () => {
    expect(planAttempts(planRoute(input()))).toHaveLength(1);
  });

  it('adds this provider’s other models when model fallback is on', () => {
    const plan = planRoute(input({ allowModelFallback: true }));
    const attempts = planAttempts(plan);
    expect(attempts.length).toBeGreaterThan(1);
    expect(attempts.every((a) => a.provider === 'gemini')).toBe(true);
  });

  /**
   * The two policies are independent, and this is the test that says so:
   * provider fallback alone crosses vendors without expanding the model chain.
   */
  it('adds other backends only when provider fallback is on', () => {
    const modelOnly = planAttempts(planRoute(input({ allowModelFallback: true })));
    expect(new Set(modelOnly.map((a) => a.provider)).size).toBe(1);

    const crossProvider = planAttempts(planRoute(input({ allowProviderFallback: true })));
    expect(new Set(crossProvider.map((a) => a.provider)).size).toBeGreaterThan(1);
    expect(crossProvider).toHaveLength(3);
  });

  it('offers the user’s model preference only to the provider it was chosen for', () => {
    const plan = planRoute(
      input({
        settings: settingsFor('gemini', 'gemini-2.5-pro'),
        allowProviderFallback: true,
      }),
    );
    expect(plan.primary.model).toBe('gemini-2.5-pro');
    const foreign = plan.fallbacks.find((c) => c.provider !== 'gemini');
    expect(foreign?.model).not.toBe('gemini-2.5-pro');
  });
});

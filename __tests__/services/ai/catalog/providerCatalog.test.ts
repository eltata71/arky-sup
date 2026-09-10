/**
 * Model resolution has to stay inside the active provider's id space. The bug
 * these tests pin down was real and reproducible: the `quick` tier is a
 * deliberate cost floor that returned `gemini-2.5-flash-lite` regardless of
 * provider, so selecting OpenRouter still sent Google's id to a backend whose
 * catalog has never contained it.
 */

import { describe, expect, it } from 'vitest';
import {
  catalogFor,
  catalogForSettings,
  geminiCatalog,
  openRouterCatalog,
  registeredCatalogProviders,
  resolveInCatalog,
  resolveModelForSettings,
  resolveProviderId,
} from '../../../../services/ai/catalog';
import { AIModelRouter } from '../../../../services/ai/modelRouting/AIModelRouter';
import type { AIConfig, Settings } from '../../../../types';

const settingsFor = (over: Partial<AIConfig> = {}): Settings => ({
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model: '',
    temperature: 0.5,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource: 'global',
    ...over,
  },
});

describe('catalog ownership', () => {
  it('recognises Gemini ids, including the `models/` prefix people paste', () => {
    expect(geminiCatalog.owns('gemini-2.5-flash')).toBe(true);
    expect(geminiCatalog.owns('models/gemini-2.5-pro')).toBe(true);
  });

  it('does not claim another provider’s slug', () => {
    expect(geminiCatalog.owns('anthropic/claude-3.5-sonnet')).toBe(false);
    expect(geminiCatalog.owns('openrouter/auto')).toBe(false);
  });

  it('recognises OpenRouter slugs by their vendor/model shape', () => {
    expect(openRouterCatalog.owns('openrouter/auto')).toBe(true);
    expect(openRouterCatalog.owns('anthropic/claude-3.5-sonnet')).toBe(true);
    expect(openRouterCatalog.owns('deepseek/deepseek-chat')).toBe(true);
  });

  it('does not claim a bare Gemini id', () => {
    expect(openRouterCatalog.owns('gemini-2.5-flash-lite')).toBe(false);
    expect(openRouterCatalog.owns('gemini-2.5-flash')).toBe(false);
  });

  it('claims nothing for an empty id', () => {
    expect(openRouterCatalog.owns('   ')).toBe(false);
    expect(geminiCatalog.owns('')).toBe(false);
  });
});

describe('resolveInCatalog', () => {
  it('uses the tier model when nothing was requested', () => {
    const out = resolveInCatalog(geminiCatalog, 'default');
    expect(out.id).toBe(geminiCatalog.tiers.default);
    expect(out.source).toBe('global');
  });

  it('honours a requested model the catalog owns', () => {
    const out = resolveInCatalog(geminiCatalog, 'deep', 'gemini-2.5-pro');
    expect(out.id).toBe('gemini-2.5-pro');
    expect(out.source).toBe('user');
  });

  it('keeps the quick tier on its floor even against a user preference', () => {
    const out = resolveInCatalog(geminiCatalog, 'quick', 'gemini-2.5-pro');
    expect(out.id).toBe(geminiCatalog.tiers.quick);
    expect(out.source).toBe('tier-floor');
    expect(out.requested).toBe('gemini-2.5-pro');
  });

  it('substitutes a foreign id rather than forwarding it, and says so', () => {
    const out = resolveInCatalog(openRouterCatalog, 'default', 'gemini-2.5-flash');
    expect(out.id).toBe(openRouterCatalog.tiers.default);
    expect(out.source).toBe('fallback');
    // The substitution is attributable: the trace can show what was asked for.
    expect(out.requested).toBe('gemini-2.5-flash');
  });

  it('collapses a retired Gemini alias onto its replacement', () => {
    const out = resolveInCatalog(geminiCatalog, 'default', 'gemini-3-flash-preview');
    expect(out.id).toBe(geminiCatalog.defaultModel);
    expect(out.requested).toBe('gemini-3-flash-preview');
  });
});

describe('provider resolution from settings', () => {
  it('treats settings with no declared provider as Gemini', () => {
    // Lazy migration: `aiConfig.provider` postdates the first releases, and a
    // stored record without it was implicitly using Gemini.
    expect(resolveProviderId(settingsFor())).toBe('gemini');
    expect(resolveProviderId(undefined)).toBe('gemini');
  });

  it('honours a declared OpenRouter provider', () => {
    expect(resolveProviderId(settingsFor({ provider: 'openrouter' }))).toBe('openrouter');
    expect(catalogForSettings(settingsFor({ provider: 'openrouter' })).provider).toBe('openrouter');
  });

  it('falls back to Gemini’s catalog for a provider with none registered', () => {
    expect(catalogFor('azure').provider).toBe('gemini');
  });

  it('registers a catalog for every shipped provider', () => {
    expect(registeredCatalogProviders()).toEqual(
      expect.arrayContaining(['gemini', 'openrouter']),
    );
  });
});

describe('resolveModelForSettings — the regression this phase closes', () => {
  /**
   * Every tier, for every registered provider, must resolve to an id that
   * provider owns. This is the assertion that would have caught the original
   * defect, and it is written as a sweep rather than a case so a provider
   * added later cannot quietly reintroduce it.
   */
  it.each(['quick', 'default', 'deep'] as const)(
    'keeps the %s tier inside the active provider’s id space',
    (tier) => {
      const gemini = resolveModelForSettings(tier, settingsFor({ provider: 'gemini' }));
      expect(geminiCatalog.owns(gemini.id)).toBe(true);

      const openrouter = resolveModelForSettings(
        tier,
        settingsFor({ provider: 'openrouter', model: 'openrouter/auto' }),
      );
      expect(openRouterCatalog.owns(openrouter.id)).toBe(true);
    },
  );

  it('never emits a Gemini id for the quick tier under OpenRouter', () => {
    const out = resolveModelForSettings(
      'quick',
      settingsFor({ provider: 'openrouter', model: 'anthropic/claude-3.5-sonnet' }),
    );
    expect(out.id).not.toMatch(/^gemini-/);
    expect(openRouterCatalog.owns(out.id)).toBe(true);
  });

  it('never emits a Gemini id when OpenRouter settings carry a stale model', () => {
    // The state a user lands in by switching provider on an older record.
    const out = resolveModelForSettings(
      'default',
      settingsFor({ provider: 'openrouter', model: 'gemini-2.5-flash' }),
    );
    expect(out.id).toBe(openRouterCatalog.defaultModel);
  });
});

describe('AIModelRouter is catalog-driven', () => {
  const router = new AIModelRouter();

  it('routes to the active provider’s tier model', () => {
    const route = router.route({
      mode: 'balanced',
      settings: settingsFor({ provider: 'openrouter', model: 'openrouter/auto' }),
    });
    expect(openRouterCatalog.owns(route.id)).toBe(true);
  });

  it('refuses a modelOverride the active catalog does not own', () => {
    const route = router.route({
      mode: 'balanced',
      modelOverride: 'gemini-2.5-flash-lite',
      settings: settingsFor({ provider: 'openrouter', model: 'openrouter/auto' }),
    });
    expect(route.id).not.toBe('gemini-2.5-flash-lite');
    expect(openRouterCatalog.owns(route.id)).toBe(true);
    expect(route.requested).toBe('gemini-2.5-flash-lite');
    expect(route.source).toBe('fallback');
  });

  it('still honours an override the active catalog does own', () => {
    const route = router.route({
      mode: 'balanced',
      modelOverride: 'anthropic/claude-3.5-sonnet',
      settings: settingsFor({ provider: 'openrouter', model: 'openrouter/auto' }),
    });
    expect(route.id).toBe('anthropic/claude-3.5-sonnet');
    expect(route.source).toBe('user');
  });

  it('draws the fallback chain from the active provider', () => {
    const route = router.route({
      mode: 'balanced',
      settings: settingsFor({ provider: 'openrouter', model: 'openrouter/auto' }),
    });
    for (const model of route.fallbackChain) {
      expect(openRouterCatalog.owns(model)).toBe(true);
    }
  });

  it('exposes the tier table of the active provider', () => {
    const table = router.tierTable(settingsFor({ provider: 'openrouter' }));
    expect(table).toEqual(openRouterCatalog.tiers);
  });
});

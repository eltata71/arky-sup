import { describe, expect, it } from 'vitest';
import { AIModelRouter } from '../../../../services/ai/modelRouting/AIModelRouter';
import { MODEL_TIERS } from '../../../../lib/ai/modelCatalog';
import type { Settings } from '../../../../types';

const baseSettings = (model = ''): Settings => ({
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model,
    temperature: 0.7,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource: 'global',
  },
});

describe('AIModelRouter', () => {
  const router = new AIModelRouter();

  it('maps modes to tiers and honours explicit tier overrides', () => {
    expect(router.resolveTier('fast')).toBe('quick');
    expect(router.resolveTier('balanced')).toBe('default');
    expect(router.resolveTier('high-quality')).toBe('deep');
    expect(router.resolveTier('balanced', 'deep')).toBe('deep');
  });

  it('uses the tier default when the user has no preference', () => {
    const route = router.route({ mode: 'balanced', settings: baseSettings('') });
    expect(route.id).toBe(MODEL_TIERS.default);
    expect(route.tier).toBe('default');
    expect(route.source).toBe('global');
    expect(route.fallbackChain).not.toContain(route.id);
  });

  it('honours the user-selected model for the deep tier', () => {
    const route = router.route({ mode: 'high-quality', settings: baseSettings('gemini-2.5-pro') });
    expect(route.id).toBe('gemini-2.5-pro');
    expect(route.source).toBe('user');
    expect(route.tier).toBe('deep');
  });

  it('floors the quick tier to stable Flash even when the user picked something else', () => {
    const route = router.route({ mode: 'fast', settings: baseSettings('gemini-2.5-pro') });
    expect(route.id).toBe(MODEL_TIERS.quick);
    expect(route.source).toBe('tier-floor');
  });

  it('respects an explicit modelOverride and records it as a user choice', () => {
    const route = router.route({ mode: 'balanced', modelOverride: 'gemini-3.1-pro' });
    expect(route.id).toBe('gemini-3.1-pro');
    expect(route.source).toBe('user');
    expect(route.requested).toBe('gemini-3.1-pro');
    expect(route.fallbackChain).not.toContain('gemini-3.1-pro');
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../../types';
import { getDefaultModelOptions, listCurrentGeminiModels, resolveEffectiveApiKey } from '../../lib/ai/modelCatalog';

const settings = (apiKeySource: 'global' | 'user'): Settings => ({
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource,
  },
});

describe('Gemini key resolution in the browser', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv('VITE_GEMINI_API_KEY', 'legacy-browser-operator-key');
  });

  afterEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('never resolves a global VITE key for a direct browser call', () => {
    expect(resolveEffectiveApiKey(settings('global'))).toBe('');
  });

  it('does not fall back to a VITE key when BYOK was selected without a stored key', () => {
    expect(resolveEffectiveApiKey(settings('user'))).toBe('');
  });

  it('uses a stored personal key only after the user selected BYOK', () => {
    localStorage.setItem('user_gemini_key', 'personal-key');
    expect(resolveEffectiveApiKey(settings('user'))).toBe('personal-key');
    expect(resolveEffectiveApiKey(settings('global'))).toBe('');
  });

  it('uses the static model catalogue without BYOK and never calls Gemini directly', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(listCurrentGeminiModels(settings('global'))).resolves.toEqual(getDefaultModelOptions());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

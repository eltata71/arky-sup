/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveOpenRouterApiKey } from '../../services/ai/providers/openrouter/openRouterApiKey';
import type { Settings } from '../../types';

const base: Settings = { globalContext: [], language: 'es', theme: 'dark',
  aiConfig: { model: 'x', temperature: 0.2, tone: 't', languageStyle: 'c', apiKeySource: 'global' } };

afterEach(() => { localStorage.clear(); });

describe('resolveOpenRouterApiKey', () => {
  it('usa la key global (VITE_OPENROUTER_API_KEY) cuando apiKeySource=global', () => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'sk-or-global');
    expect(resolveOpenRouterApiKey(base)).toBe('sk-or-global');
    vi.unstubAllEnvs();
  });
  it('usa la key del usuario (localStorage) cuando apiKeySource=user', () => {
    localStorage.setItem('user_openrouter_key', 'sk-or-user');
    const s = { ...base, aiConfig: { ...base.aiConfig, apiKeySource: 'user' as const } };
    expect(resolveOpenRouterApiKey(s)).toBe('sk-or-user');
  });
  it('prefiere la key del usuario sobre la global en user', () => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'sk-or-global');
    localStorage.setItem('user_openrouter_key', 'sk-or-user');
    const s = { ...base, aiConfig: { ...base.aiConfig, apiKeySource: 'user' as const } };
    expect(resolveOpenRouterApiKey(s)).toBe('sk-or-user');
    vi.unstubAllEnvs();
  });
  it('devuelve string vacío cuando no hay key', () => {
    expect(resolveOpenRouterApiKey(base)).toBe('');
  });
});

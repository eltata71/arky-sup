import type { Settings } from '../../../../types';

/**
 * Resolve the Anthropic API key, mirroring the precedence the other providers
 * use: the user's own key when they chose to supply one, otherwise the
 * deployment key, with each falling back to the other rather than failing.
 */
export function resolveAnthropicApiKey(settings?: Settings): string {
  const apiKeySource = settings?.aiConfig?.apiKeySource || 'global';
  const userKey = typeof localStorage !== 'undefined'
    ? localStorage.getItem('user_anthropic_key') : null;
  const globalKey = (import.meta.env.VITE_ANTHROPIC_API_KEY ?? '').toString().trim();
  if (apiKeySource === 'user') {
    if (userKey && userKey.trim().length > 0) return userKey.trim();
    if (globalKey.length > 0) return globalKey;
  } else {
    if (globalKey.length > 0) return globalKey;
    if (userKey && userKey.trim().length > 0) return userKey.trim();
  }
  return '';
}

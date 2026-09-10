import type { Settings } from '../../../../types';

export function resolveOpenRouterApiKey(settings?: Settings): string {
  const apiKeySource = settings?.aiConfig?.apiKeySource || 'global';
  const userKey = typeof localStorage !== 'undefined'
    ? localStorage.getItem('user_openrouter_key') : null;
  const globalKey = (import.meta.env.VITE_OPENROUTER_API_KEY ?? '').toString().trim();
  if (apiKeySource === 'user') {
    if (userKey && userKey.trim().length > 0) return userKey.trim();
    if (globalKey.length > 0) return globalKey;
  } else {
    if (globalKey.length > 0) return globalKey;
    if (userKey && userKey.trim().length > 0) return userKey.trim();
  }
  return '';
}

/**
 * byokConsent — has the user chosen to spend their own key?
 *
 * Under `VITE_AI_STRICT_PROXY` a failed proxy call must not silently become a
 * direct browser call with the *operator's* credential. One case stays legal:
 * the user went to Ajustes → IA, selected "mi propia clave" and pasted one.
 * That request spends a key its owner supplied knowingly, so routing it around
 * a broken proxy exposes nothing that was not already theirs.
 *
 * Both halves are required, and that is the whole point of this module.
 * `resolveOpenRouterApiKey` and `getEffectiveApiKey` both fall back to the
 * global key when the preference is `'user'` but no key was stored — sensible
 * for availability, and exactly the substitution that would turn "the user
 * consented" into "the operator's key went to the browser". Asking only
 * `apiKeySource === 'user'` would therefore approve the leak it is meant to
 * catch.
 */

import type { Settings } from '../../types';
import { proxyProviderFor } from './catalog';

const USER_KEY_STORAGE: Record<'gemini' | 'openrouter', string> = {
  gemini: 'user_gemini_key',
  openrouter: 'user_openrouter_key',
};

function readStoredKey(storageKey: string): string {
  try {
    if (typeof localStorage === 'undefined') return '';
    return (localStorage.getItem(storageKey) ?? '').trim();
  } catch {
    // Private-mode Safari throws on access; treat it as "no key stored".
    return '';
  }
}

/**
 * True only when the user both selected their own key **and** actually stored
 * one for the provider this request would use.
 */
export function hasConsentedByok(settings?: Settings): boolean {
  if (settings?.aiConfig?.apiKeySource !== 'user') return false;

  const provider = proxyProviderFor(settings);
  // A provider the catalog cannot place has no key slot to consent about.
  if (!provider) return false;

  return readStoredKey(USER_KEY_STORAGE[provider]).length > 0;
}

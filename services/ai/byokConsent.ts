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
import { resolveProviderId } from './catalog';
import type { AIProviderId } from './core/AIModel';

const USER_KEY_STORAGE: Partial<Record<AIProviderId, string>> = {
  gemini: 'user_gemini_key',
  openrouter: 'user_openrouter_key',
  anthropic: 'user_anthropic_key',
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

  const provider = resolveProviderId(settings);
  const storageKey = USER_KEY_STORAGE[provider];
  // A provider without a browser key slot cannot be consented as BYOK.
  if (!storageKey) return false;

  return readStoredKey(storageKey).length > 0;
}

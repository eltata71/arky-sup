import type { Dictionary, Translations, UiLanguage } from './translations';
import { ensureFullSpanish, spanishDictionary } from './spanishStore';

/** What is available before anything has loaded: the default language's core. */
export const INITIAL_TRANSLATIONS: Translations = { es: spanishDictionary };

/**
 * Fetches a language's dictionary. Spanish ships as a core plus per-route
 * sections (14.6): this completes it. Each other dictionary is its own chunk.
 */
export async function loadDictionary(language: UiLanguage): Promise<Dictionary> {
  if (language === 'es') return ensureFullSpanish();
  return (await import('./locales/en')).en;
}

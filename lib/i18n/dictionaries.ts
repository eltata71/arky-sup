import type { Dictionary, Translations, UiLanguage } from './translations';
import { es } from './locales/es';

/** What is available before anything has loaded: the default language. */
export const INITIAL_TRANSLATIONS: Translations = { es };

/**
 * Fetches a language's dictionary. Spanish is already in the entry chunk, so
 * only the others cost a request. Each dictionary is its own chunk.
 */
export async function loadDictionary(language: UiLanguage): Promise<Dictionary> {
  if (language === 'es') return es;
  return (await import('./locales/en')).en;
}

/**
 * Key lookup with placeholder substitution.
 *
 * Moved out of `utils.ts`, where it sat under a `// --- Translation (from
 * AppContext) ---` heading with exactly one caller. A shared-utility module is
 * where functions go when nobody has decided what they belong to; i18n has an
 * owner now.
 */

import type { Translations } from './translations';

/**
 * Looks up a translation key and performs placeholder substitution.
 *
 * An unknown key returns the key. That is the intended failure: a literal
 * `docCreatedSuccess` on screen names the missing entry, where an empty string
 * would be a blank label with nothing to search for.
 */
export function translate(
  translations: Translations,
  language: string,
  key: string,
  replacements?: Record<string, string>,
): string {
  let translation = translations[language]?.[key] || key;
  if (replacements) {
    Object.entries(replacements).forEach(([placeholder, value]) => {
      translation = translation.replace(`{${placeholder}}`, value);
    });
  }
  return translation;
}

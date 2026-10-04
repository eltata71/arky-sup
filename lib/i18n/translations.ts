/**
 * The UI dictionary, one module per language.
 *
 * Spanish is the product's language (`<html lang="es">`) and is the only
 * dictionary in the eager payload. English — required since R-16 — is loaded
 * with `import()` when someone selects it, so the second language costs the
 * first one nothing. While it loads, the lookup answers in Spanish: a screen
 * never shows a translation key, and never a half-empty interface.
 *
 * A key missing from a language still falls back to the key itself — a visible
 * `artifactExportTitle` is a bug report, a blank label is not.
 */

/** One language's strings, keyed by translation key. */
export type Dictionary = Record<string, string>;

/** A dictionary per language code. */
export type Translations = Record<string, Dictionary>;

export type UiLanguage = 'es' | 'en';

export const UI_LANGUAGES: readonly UiLanguage[] = ['es', 'en'];

export const DEFAULT_LANGUAGE: UiLanguage = 'es';

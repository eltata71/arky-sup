/**
 * `lib/i18n` — the UI dictionaries and the lookup that reads them.
 *
 * Framework-agnostic on purpose: it is under `lib/`, imports no React and no
 * SDK, and `AppContext` binds it to `Settings.language` in `useSettingsState`.
 */

export { translate } from './translate';
export { INITIAL_TRANSLATIONS, loadDictionary } from './dictionaries';
export { DEFAULT_LANGUAGE, UI_LANGUAGES } from './translations';
export type { Dictionary, Translations, UiLanguage } from './translations';

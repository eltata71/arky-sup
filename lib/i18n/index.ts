/**
 * `lib/i18n` — the UI dictionary and the lookup that reads it.
 *
 * Framework-agnostic on purpose: it is under `lib/`, imports no React and no
 * Firebase, and `AppContext` binds it to `Settings.language` in one `useCallback`.
 */

export { translate } from './translate';
export { translations } from './translations';
export type { Translations } from './translations';

import { useCallback } from 'react';
import { useOptionalAppContext } from '../context/AppContext';
import { INITIAL_TRANSLATIONS, translate, DEFAULT_LANGUAGE } from '../lib/i18n';

export type UiText = (key: string, replacements?: Record<string, string>) => string;

/**
 * `t()` for a component that may render outside `AppContextProvider` — a
 * viewer inside a test, or a portal in a second window. Inside the provider it
 * is the app's own `t()`; outside it answers from the Spanish dictionary, so
 * the copy lives in one place instead of a `t?.(key) ?? 'literal'` per label.
 */
export function useUiText(): UiText {
  const app = useOptionalAppContext();
  const fallback = useCallback<UiText>(
    (key, replacements) => translate(INITIAL_TRANSLATIONS, DEFAULT_LANGUAGE, key, replacements),
    [],
  );
  return app?.t ?? fallback;
}

import { createContext, useContext, type ReactNode } from 'react';
import { spanishFallback, type Translator } from './spanishFallback';

const TranslationContext = createContext<Translator | undefined>(undefined);

export function UiTranslationProvider({ t, children }: { t: Translator; children: ReactNode }) {
  return <TranslationContext.Provider value={t}>{children}</TranslationContext.Provider>;
}

/** Standalone previews and tests use the product's default Spanish copy. */
export function useUiTranslation(): Translator {
  return useContext(TranslationContext) ?? spanishFallback;
}

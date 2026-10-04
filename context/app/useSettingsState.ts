/**
 * Settings, the theme they apply, and the `t()` bound to their language.
 *
 * `t` lives here rather than in `lib/i18n` because it is the one part of
 * translation that depends on React state: the dictionary and the lookup are
 * pure, and binding them to `settings.language` is a one-line `useCallback`.
 *
 * `updateSettings` writes optimistically and reverts the whole object when the
 * remote write is not confirmed — a half-applied settings record is worse than
 * one that visibly did not save.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../../types';
import { confirmedSettingsRevision, settingsRepository } from '../../services/settings';
import { DEFAULT_LANGUAGE, INITIAL_TRANSLATIONS, loadDictionary, translate, type Translations, type UiLanguage } from '../../lib/i18n';
import { useAuth } from '../AuthContext';
import { mirrorThemeForBoot } from '../../hooks/useTheme';
import { initialSettings } from './initialSettings';
import type { PersistenceReporter } from './usePersistenceReporter';

export interface SettingsState {
  readonly settings: Settings;
  readonly setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  /** Mirrors `settings.globalContext` for callbacks that must stay stable. */
  readonly globalContextRef: React.MutableRefObject<string[]>;
  readonly t: (key: string, replacements?: Record<string, string>) => string;
  readonly updateSettings: (updates: Partial<Settings>) => Promise<void>;
}

export const useSettingsState = (reporter: PersistenceReporter): SettingsState => {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const { user } = useAuth();
  const { handleWriteResult, setPersistenceStatus } = reporter;

  const globalContextRef = useRef(settings.globalContext);
  globalContextRef.current = settings.globalContext;

  /*
   * El tema: se aplica al `<html>` y se refleja en `localStorage`.
   *
   * `settings.theme` es la única fuente —persiste en Firestore y sigue al
   * usuario entre dispositivos— y este efecto es el único sitio que toca la
   * clase. El espejo en `localStorage` existe sólo para el script de arranque
   * de `index.html`, que corre antes que React y evita el destello claro; sin
   * mantenerlo aquí, cada recarga pintaba el tema de la sesión anterior durante
   * un instante. Es un espejo derivado, nunca una segunda fuente.
   */
  useEffect(() => {
    const dark = settings.theme === 'dark';
    document.documentElement.classList.toggle('dark', dark);
    mirrorThemeForBoot(dark ? 'dark' : 'light');
  }, [settings.theme]);

  /*
   * El español viaja en la carga inicial; el resto de idiomas se descarga al
   * elegirse. Mientras llega, `t()` contesta en español: nunca una clave a la
   * vista ni una interfaz a medias.
   */
  const [dictionaries, setDictionaries] = useState<Translations>(INITIAL_TRANSLATIONS);
  useEffect(() => {
    const language = settings.language as UiLanguage;
    if (dictionaries[language]) return;
    let cancelled = false;
    loadDictionary(language)
      .then(dictionary => { if (!cancelled) setDictionaries(current => ({ ...current, [language]: dictionary })); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [settings.language, dictionaries]);

  useEffect(() => {
    document.documentElement.lang = dictionaries[settings.language] ? settings.language : DEFAULT_LANGUAGE;
  }, [settings.language, dictionaries]);

  const t = useCallback((key: string, replacements?: Record<string, string>) => {
    const language = dictionaries[settings.language] ? settings.language : DEFAULT_LANGUAGE;
    return translate(dictionaries, language, key, replacements);
  }, [settings.language, dictionaries]);

  const updateSettings = useCallback(async (updates: Partial<Settings>) => {
    const previous = settings;
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
    setPersistenceStatus('saving');
    const result = await settingsRepository.save(newSettings, user?.uid);
    if (!handleWriteResult(result, 'Configuración guardada en base de datos.')) {
      setSettings(previous);
      return;
    }
    // La revisión confirmada vuelve al estado (F6-03): la próxima escritura
    // compara contra ella, no contra un mapa del repositorio.
    const revision = confirmedSettingsRevision(result);
    if (revision !== undefined) setSettings((current) => ({ ...current, revision }));
  }, [settings, user, handleWriteResult, setPersistenceStatus]);

  return { settings, setSettings, globalContextRef, t, updateSettings };
};

/**
 * El tema, con **un** dueño.
 *
 * Hasta ahora había dos, y nunca se ponían de acuerdo. `useSettingsState`
 * escribía la clase `dark` del `<html>` a partir de `settings.theme`, que es la
 * preferencia del usuario y viaja en Firestore; este hook la escribía a partir
 * de `localStorage['arky_theme']`, con su propio concepto de `'system'`. Con la
 * cuenta recién creada —settings en `dark`, `localStorage` vacío— la aplicación
 * se pintaba oscura y el botón del raíl decía «Modo oscuro»; al pulsarlo
 * guardaba `arky_theme = 'dark'`, que era lo que ya estaba en pantalla, **y no
 * pasaba nada visible**. Un interruptor de tema que no cambia el tema.
 *
 * Ahora la única fuente es `settings.theme`:
 *
 * - **La preferencia vive en los ajustes**, así que persiste en Firestore y
 *   sigue al usuario entre dispositivos, que es lo que la gente espera de un
 *   tema y lo que `localStorage` nunca podía dar.
 * - **`localStorage['arky_theme']` sigue existiendo, como espejo**, y ése es su
 *   único trabajo: el script de arranque de `index.html` lo lee antes de que
 *   React exista para no pintar un destello claro antes del primer render.
 *   `useSettingsState` lo mantiene al día. Es un espejo derivado, igual que los
 *   códigos `NEG-YYYY-NNN` del portafolio: se lee cuando aún no hay nada mejor,
 *   y nunca decide.
 * - **`'system'` desaparece del modelo** porque `Settings['theme']` es
 *   `'light' | 'dark'` y nunca tuvo un tercer valor. El script de arranque sigue
 *   cayendo a la preferencia del sistema cuando no hay espejo todavía, que es el
 *   único momento en que no hay una preferencia que respetar.
 */

import { useCallback } from 'react';
import { useAppContext } from '../context/AppContext';

export type ResolvedTheme = 'light' | 'dark';

/** La clave del espejo. La misma que lee el script de `index.html`. */
export const THEME_STORAGE_KEY = 'arky_theme';

/**
 * Escribe el espejo que lee el arranque. Silencioso a propósito: en una ventana
 * privada `setItem` lanza, y perder la protección contra el destello no es
 * motivo para tirar abajo la pantalla.
 */
export const mirrorThemeForBoot = (theme: ResolvedTheme): void => {
    try {
        window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
        /* Sin espejo habrá un destello en el próximo arranque, nada más. */
    }
};

export function useTheme(): {
    resolved: ResolvedTheme;
    setMode: (mode: ResolvedTheme) => void;
    toggle: () => void;
} {
    const { settings, updateSettings } = useAppContext();
    const resolved: ResolvedTheme = settings.theme === 'dark' ? 'dark' : 'light';

    const setMode = useCallback((mode: ResolvedTheme) => {
        // El espejo se escribe aquí y no sólo en el efecto de los ajustes para
        // que el próximo arranque acierte incluso si la escritura remota falla:
        // el tema es una preferencia visual, y degradar a «se ve bien pero no se
        // sincronizó» es mejor que degradar a un destello blanco.
        mirrorThemeForBoot(mode);
        void updateSettings({ theme: mode });
    }, [updateSettings]);

    const toggle = useCallback(() => {
        setMode(resolved === 'dark' ? 'light' : 'dark');
    }, [resolved, setMode]);

    return { resolved, setMode, toggle };
}

export default useTheme;

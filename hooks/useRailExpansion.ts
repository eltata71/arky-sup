/**
 * Si el raíl de navegación se queda abierto, y el recuerdo de esa decisión.
 *
 * El despliegue por hover resuelve la consulta puntual —«¿qué era Entregables?»—
 * y es exactamente el gesto equivocado para quien está aprendiendo el producto:
 * obliga a sostener el ratón encima para poder leer. El pestillo existe para
 * eso, y por eso se recuerda: una preferencia de accesibilidad que hay que
 * volver a activar en cada carga no es una preferencia, es una tarea.
 *
 * Vive en `localStorage` y no en los ajustes del usuario a propósito. Es una
 * decisión **por dispositivo**: el mismo arquitecto quiere el raíl fijo en el
 * portátil de 13" donde cada píxel cuenta menos que la claridad, y plegado en
 * el monitor de 27" donde ya tiene sitio para todo. Guardarla en Firestore la
 * sincronizaría entre los dos, que es justo lo contrario de lo que se quiere.
 *
 * Cada acceso va envuelto en `try`/`catch`: en una ventana privada, o con las
 * cookies de sitio bloqueadas, el simple hecho de *leer* `localStorage` lanza.
 * Un raíl que tira la aplicación abajo por no poder recordar su propia anchura
 * sería un intercambio ridículo.
 */

import { useCallback, useState } from 'react';

const STORAGE_KEY = 'arky.rail.pinned';

const readPinned = (): boolean => {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

export interface RailExpansion {
    /** True cuando el raíl se queda abierto sin necesidad de hover ni foco. */
    pinned: boolean;
    setPinned: (next: boolean) => void;
}

export const useRailExpansion = (): RailExpansion => {
    // Inicializador perezoso: leer `localStorage` en cada render costaría un
    // acceso síncrono a disco por cada navegación.
    const [pinned, setPinnedState] = useState<boolean>(readPinned);

    const setPinned = useCallback((next: boolean) => {
        setPinnedState(next);
        try {
            window.localStorage.setItem(STORAGE_KEY, String(next));
        } catch {
            // Sin persistencia el pestillo sigue funcionando durante la sesión,
            // que es la degradación correcta: se pierde el recuerdo, no la
            // función.
        }
    }, []);

    return { pinned, setPinned };
};

export default useRailExpansion;

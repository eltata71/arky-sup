/**
 * Si la última intención del usuario vino del teclado o del puntero.
 *
 * Existe porque un `focus` no dice **cómo** llegó el foco, y hay controles cuyo
 * comportamiento correcto depende exactamente de eso. El caso que lo motivó: el
 * raíl de navegación se despliega al recibir foco, porque quien tabula a ciegas
 * necesita leer dónde está — pero un clic con el ratón también da foco, así que
 * cambiar el tema dejaba el raíl abierto tapando el contenido hasta que el
 * usuario pinchaba en otro sitio.
 *
 * Es la misma heurística que usa el navegador para `:focus-visible`, escrita
 * aquí por una razón concreta: **jsdom implementa `matches(':focus-visible')` y
 * siempre devuelve `false`**, así que apoyarse en el selector deja la rama de
 * teclado —la que sirve a quien más depende de ella— sin ninguna prueba que la
 * cubra. Un comportamiento de accesibilidad que no se puede comprobar es uno
 * que se rompe en silencio.
 *
 * Los escuchadores van en fase de captura y sobre `document`, porque el primer
 * `Tab` que entra en un componente se pulsa **fuera** de él: un `keydown` local
 * nunca lo vería.
 */

import { useEffect, useRef, type RefObject } from 'react';

export type InputModality = 'keyboard' | 'pointer';

/**
 * Las teclas que mueven el foco. Escribir una letra no convierte la sesión en
 * «de teclado»: alguien puede estar rellenando un campo con el ratón en la mano,
 * y el siguiente clic no debe comportarse como una tabulación.
 */
const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
    'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End',
]);

/**
 * Devuelve una `ref` con la modalidad actual. Es una `ref` y no un estado a
 * propósito: cambia en cada pulsación y en cada clic, y no hay nada que
 * repintar por ello — provocar un render por mover el ratón sería un coste
 * permanente a cambio de nada.
 */
export const useKeyboardModality = (): RefObject<InputModality> => {
    const modality = useRef<InputModality>('pointer');

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (NAVIGATION_KEYS.has(event.key)) modality.current = 'keyboard';
        };
        const onPointerDown = () => { modality.current = 'pointer'; };

        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('pointerdown', onPointerDown, true);
        // `mousedown` además de `pointerdown` para los navegadores y entornos de
        // prueba que no emiten eventos de puntero.
        document.addEventListener('mousedown', onPointerDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('mousedown', onPointerDown, true);
        };
    }, []);

    return modality;
};

export default useKeyboardModality;

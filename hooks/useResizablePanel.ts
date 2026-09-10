/**
 * Un panel al que el usuario le decide el ancho, y que lo recuerda.
 *
 * El copiloto vivía a 384 px fijos, y ése es el ancho equivocado dos veces: de
 * sobra cuando alguien está mirando un diagrama a pantalla completa y lo único
 * que quiere del asistente es no perderlo de vista, y escaso cuando está
 * leyendo con él una recomendación de doce párrafos. Un ancho fijo obliga a
 * elegir entre esos dos usos en tiempo de diseño, y son el mismo usuario en la
 * misma sesión.
 *
 * ## Arrastrar no puede ser la única forma
 *
 * WCAG 2.2 añadió el criterio 2.5.7 (*Dragging Movements*, AA) justamente por
 * esto: una acción que sólo se consigue arrastrando deja fuera a quien usa
 * teclado, conmutador o control por voz, y a quien no puede sostener un gesto
 * de precisión. Así que el ancho se cambia también con las flechas —paso fino,
 * paso grueso con `Shift`— y `Home`/`End` llevan a los extremos. Es la misma
 * función por dos caminos, no un atajo para expertos.
 *
 * ## Lo que el hook no hace
 *
 * No anima. Un panel que interpola su ancho mientras se arrastra va siempre un
 * fotograma por detrás del cursor, y esa desincronización se lee como retardo
 * del sistema. El ancho sigue al puntero exactamente; la animación queda para
 * abrir y cerrar, que es cuando nadie está apuntando a nada.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ResizablePanelOptions {
  /** Ancho por defecto, y el que se restaura al hacer doble clic en el asa. */
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /**
   * Clave de `localStorage`. Es una decisión por dispositivo —el ancho útil en
   * un portátil de 13" y en un monitor de 27" no es el mismo—, así que no viaja
   * a los ajustes del usuario.
   */
  storageKey: string;
  /**
   * De qué lado del panel está el asa. `'start'` significa que arrastrar hacia
   * la izquierda ensancha (el caso del panel derecho); `'end'`, lo contrario.
   */
  edge?: 'start' | 'end';
}

export interface ResizablePanel {
  width: number;
  /** True mientras se está arrastrando: el llamador apaga transiciones. */
  resizing: boolean;
  /** Handlers para el asa, ya con el teclado resuelto. */
  handleProps: {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
    onDoubleClick: () => void;
    role: 'separator';
    'aria-orientation': 'vertical';
    'aria-valuenow': number;
    'aria-valuemin': number;
    'aria-valuemax': number;
    tabIndex: 0;
  };
  reset: () => void;
}

/** Paso de las flechas. El grueso es el que hace útil el teclado de verdad. */
const STEP = 16;
const COARSE_STEP = 64;

export const useResizablePanel = ({
  defaultWidth,
  minWidth,
  maxWidth,
  storageKey,
  edge = 'start',
}: ResizablePanelOptions): ResizablePanel => {
  const clamp = useCallback(
    (value: number) => Math.min(maxWidth, Math.max(minWidth, Math.round(value))),
    [minWidth, maxWidth],
  );

  const [width, setWidth] = useState<number>(() => {
    try {
      const stored = Number(window.localStorage.getItem(storageKey));
      // Un valor guardado por una versión con otros límites se recorta a los de
      // hoy en vez de descartarse: la preferencia sigue siendo válida aunque el
      // rango haya cambiado.
      if (Number.isFinite(stored) && stored > 0) {
        return Math.min(maxWidth, Math.max(minWidth, Math.round(stored)));
      }
    } catch {
      // Ventana privada o cookies de sitio bloqueadas: leer ya lanza.
    }
    return defaultWidth;
  });

  const [resizing, setResizing] = useState(false);
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const persist = useCallback((next: number) => {
    try {
      window.localStorage.setItem(storageKey, String(next));
    } catch {
      // Sin persistencia el panel sigue redimensionándose durante la sesión.
    }
  }, [storageKey]);

  const commit = useCallback((next: number) => {
    const clamped = clamp(next);
    setWidth(clamped);
    persist(clamped);
  }, [clamp, persist]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    // Sólo el botón principal. Un menú contextual sobre el asa no es un arrastre.
    if (event.button !== 0) return;
    event.preventDefault();
    dragState.current = { startX: event.clientX, startWidth: width };
    setResizing(true);
  }, [width]);

  // El movimiento se escucha en `window` y no en el asa: en cuanto el puntero
  // va más rápido que el repintado se sale del asa, y un listener local
  // perdería el arrastre justo cuando el usuario está siendo decidido.
  useEffect(() => {
    if (!resizing) return undefined;

    const onMove = (event: PointerEvent) => {
      const state = dragState.current;
      if (!state) return;
      const delta = event.clientX - state.startX;
      setWidth(clamp(state.startWidth + (edge === 'start' ? -delta : delta)));
    };
    const onUp = () => {
      dragState.current = null;
      setResizing(false);
      setWidth((current) => {
        persist(current);
        return current;
      });
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [resizing, clamp, edge, persist]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? COARSE_STEP : STEP;
    // Las flechas se leen en coordenadas de pantalla: en el panel derecho,
    // «izquierda» ensancha, que es lo que el usuario ve suceder.
    const grow = edge === 'start' ? 'ArrowLeft' : 'ArrowRight';
    const shrink = edge === 'start' ? 'ArrowRight' : 'ArrowLeft';

    if (event.key === grow) commit(width + step);
    else if (event.key === shrink) commit(width - step);
    else if (event.key === 'Home') commit(edge === 'start' ? maxWidth : minWidth);
    else if (event.key === 'End') commit(edge === 'start' ? minWidth : maxWidth);
    else return;

    event.preventDefault();
  }, [commit, width, edge, minWidth, maxWidth]);

  const reset = useCallback(() => commit(defaultWidth), [commit, defaultWidth]);

  return {
    width,
    resizing,
    reset,
    handleProps: {
      onPointerDown,
      onKeyDown,
      onDoubleClick: reset,
      role: 'separator',
      'aria-orientation': 'vertical',
      'aria-valuenow': width,
      'aria-valuemin': minWidth,
      'aria-valuemax': maxWidth,
      tabIndex: 0,
    },
  };
};

export default useResizablePanel;

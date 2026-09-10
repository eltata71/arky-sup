/**
 * El asa que separa dos paneles y decide cuánto ocupa cada uno.
 *
 * Tres cosas que un asa de redimensionado tiene que resolver y casi ninguna
 * resuelve:
 *
 * - **El objetivo es más ancho que la línea.** La línea visible mide 1 px
 *   porque es una separación, no un control; el objetivo del puntero mide 12 y
 *   se extiende a los dos lados. Un asa del ancho de su propia línea obliga a
 *   apuntar con precisión de píxel para una acción cuyo sentido es no tener que
 *   pensar.
 * - **Existe para el teclado.** `role="separator"` con `tabIndex` y
 *   `aria-valuenow` es lo que la convierte en un control anunciable y operable
 *   con flechas — el requisito de WCAG 2.2 · 2.5.7, que prohíbe que arrastrar
 *   sea el único camino.
 * - **Se ve antes de tocarla.** Aparece al pasar por encima y al recibir el
 *   foco. Un asa invisible hasta que la encuentras por casualidad es una
 *   función que la mayoría de los usuarios no sabrá nunca que existe, así que
 *   el estado de reposo deja una insinuación en vez de nada.
 */

import React from 'react';
import { cn } from './cn';

export interface ResizeHandleProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Qué se está redimensionando. Es el nombre accesible del separador. */
  label: string;
  /** True mientras se arrastra: el asa se queda encendida. */
  active?: boolean;
}

export const ResizeHandle: React.FC<ResizeHandleProps> = ({
  label,
  active = false,
  className,
  ...rest
}) => (
  <div
    {...rest}
    aria-label={label}
    className={cn(
      'group relative w-3 shrink-0 cursor-col-resize touch-none select-none',
      'focus:outline-none',
      className,
    )}
  >
    {/* La línea. Reposo: la separación de siempre. Hover o foco: el acento, que
        es lo que dice que esto se puede mover. */}
    <span
      aria-hidden
      className={cn(
        'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-150',
        'bg-gray-200 group-hover:bg-primary-400 dark:bg-gray-800 dark:group-hover:bg-primary-600',
        'group-focus-visible:bg-primary-500',
        active && 'bg-primary-500 dark:bg-primary-500',
      )}
    />
    {/* El agarre: tres puntos, visibles sólo cuando el asa está en juego. No es
        decoración — es lo que distingue un borde de un control. */}
    <span
      aria-hidden
      className={cn(
        'absolute left-1/2 top-1/2 flex h-8 w-3 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-0.5',
        'rounded-full opacity-0 transition-opacity duration-150',
        'group-hover:opacity-100 group-focus-visible:opacity-100',
        active && 'opacity-100',
      )}
    >
      <span className="h-0.5 w-0.5 rounded-full bg-primary-500" />
      <span className="h-0.5 w-0.5 rounded-full bg-primary-500" />
      <span className="h-0.5 w-0.5 rounded-full bg-primary-500" />
    </span>
  </div>
);

export default ResizeHandle;

/**
 * El pie del raíl: la ayuda y las utilidades que actúan sobre la aplicación en
 * vez de navegarla.
 *
 * Vive fuera de `AppRail.tsx` porque son dos responsabilidades distintas —los
 * destinos del producto y los mandos de la aplicación— y porque juntas cruzaban
 * los 20 KB que `check:module-size` permite a un módulo.
 *
 * La distinción que sostiene el diseño de este bloque: **la ayuda lleva
 * etiqueta visible en los dos estados, y las otras cuatro no.** La ayuda sirve
 * justo a quien todavía no sabe qué hace el producto, y un salvavidas suelto
 * sólo lo reconoce quien ya sabe buscarlo; la búsqueda, el tema, los atajos y el
 * pestillo los busca quien ya sabe que existen.
 */

import React from 'react';
import { Keyboard, LifeBuoy, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { MagnifyingGlassIcon, MoonIcon, SunIcon } from '../Icons';
import { cn } from '../ui/cn';
import { RailRevealedText } from './RailRevealedText';

/** Estilo compartido de las utilidades — son pares, así que coinciden. */
const UTILITY_BUTTON = 'inline-flex h-9 items-center gap-2.5 rounded-xl text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white';

/**
 * Plegado las utilidades se centran; desplegado se alinean con los destinos.
 * `w-full` es necesario: `justify-center` sobre una caja que sólo mide lo que su
 * icono no centra nada, y los glifos se pegaban al borde izquierdo del raíl.
 */
const utilityLayout = (expanded: boolean) => (expanded ? 'px-2.5' : 'w-full justify-center px-0');

export interface AppRailFooterProps {
  expanded: boolean;
  reducedMotion: boolean;
  /** Envuelve en tooltip sólo cuando está plegado. Lo aporta `AppRail`. */
  withTooltip: (label: string, node: React.ReactElement) => React.ReactElement;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onOpenSearch: () => void;
  onOpenShortcuts?: () => void;
  onOpenGuide?: () => void;
  pinned: boolean;
  onTogglePinned: () => void;
}

export const AppRailFooter: React.FC<AppRailFooterProps> = ({
  expanded,
  reducedMotion,
  withTooltip,
  theme,
  onToggleTheme,
  onOpenSearch,
  onOpenShortcuts,
  onOpenGuide,
  pinned,
  onTogglePinned,
}) => (
  <div className={cn('flex shrink-0 flex-col gap-0.5 border-t border-gray-200 pt-2 dark:border-gray-800', expanded ? 'px-3' : 'px-1')}>
      {/* La ayuda lleva etiqueta visible en los dos estados, como los
          destinos y a diferencia de las tres utilidades de debajo: es
          la única forma de que la encuentre quien todavía no sabe qué
          hace el producto, que es exactamente a quien sirve. Un icono
          de salvavidas suelto sólo lo reconoce quien ya sabe buscarlo. */}
      {onOpenGuide && withTooltip('Guía de uso · Cómo funciona la plataforma', (
          <button
              type="button"
              onClick={onOpenGuide}
              aria-haspopup="dialog"
              aria-label="Guía de uso de la plataforma"
              className={cn(
                  'flex rounded-xl text-primary-600 transition-colors hover:bg-primary-50',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  'dark:text-primary-300 dark:hover:bg-primary-950/40',
                  expanded ? 'h-9 items-center gap-2.5 px-2.5' : 'flex-col items-center gap-0.5 px-1 py-1.5',
              )}
          >
              <LifeBuoy className="h-5 w-5 shrink-0" />
              {expanded ? (
                  <RailRevealedText show reduced={reducedMotion} className="truncate text-sm font-semibold">
                      Guía de uso
                  </RailRevealedText>
              ) : (
                  <span aria-hidden className="w-full truncate text-center text-[9px] font-semibold leading-tight tracking-tight">
                      Ayuda
                  </span>
              )}
          </button>
      ))}

      {withTooltip('Búsqueda global · Cmd K', (
          <button type="button" onClick={onOpenSearch} aria-label="Búsqueda global" className={cn(UTILITY_BUTTON, utilityLayout(expanded))}>
              <MagnifyingGlassIcon className="h-5 w-5 shrink-0" />
              <RailRevealedText show={expanded} reduced={reducedMotion} className="truncate text-sm">Buscar</RailRevealedText>
          </button>
      ))}

      {withTooltip(theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro', (
          <button
              type="button"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
              className={cn(UTILITY_BUTTON, utilityLayout(expanded))}
          >
              {theme === 'dark' ? <SunIcon className="h-5 w-5 shrink-0" /> : <MoonIcon className="h-5 w-5 shrink-0" />}
              <RailRevealedText show={expanded} reduced={reducedMotion} className="truncate text-sm">
                  {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              </RailRevealedText>
          </button>
      ))}

      {onOpenShortcuts && withTooltip('Atajos de teclado · ?', (
          <button type="button" onClick={onOpenShortcuts} aria-label="Atajos de teclado" className={cn(UTILITY_BUTTON, utilityLayout(expanded))}>
              <Keyboard className="h-5 w-5 shrink-0" />
              <RailRevealedText show={expanded} reduced={reducedMotion} className="truncate text-sm">Atajos</RailRevealedText>
          </button>
      ))}

      {withTooltip(pinned ? 'Soltar el menú' : 'Fijar el menú abierto', (
          <button
              type="button"
              onClick={onTogglePinned}
              aria-pressed={pinned}
              aria-label={pinned ? 'Soltar el menú' : 'Fijar el menú abierto'}
              className={cn(UTILITY_BUTTON, utilityLayout(expanded))}
          >
              {pinned
                  ? <PanelLeftClose className="h-5 w-5 shrink-0" />
                  : <PanelLeftOpen className="h-5 w-5 shrink-0" />}
              <RailRevealedText show={expanded} reduced={reducedMotion} className="truncate text-sm">
                  {pinned ? 'Soltar menú' : 'Fijar menú'}
              </RailRevealedText>
          </button>
      ))}
  </div>
);

export default AppRailFooter;

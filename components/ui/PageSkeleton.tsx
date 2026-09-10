/**
 * La forma de una pantalla mientras llegan sus datos.
 *
 * Un disco girando en medio de la página dice «espera» y nada más. Un esqueleto
 * dice **qué** vas a recibir, y eso cambia dos cosas medibles: el usuario
 * empieza a orientarse antes de que existan los datos, y la llegada del
 * contenido se lee como el final de una carga en vez de como un cambio de
 * pantalla. Sólo funciona cuando el diseño conoce su propia forma de antemano
 * —que es el caso de todas las pantallas del portafolio— y por eso este
 * componente pide esa forma en vez de suponerla.
 *
 * Es una descripción del layout, no un dibujo: `tiles` y `panels` son cuántos
 * hay, y `PageSkeleton` los coloca en la misma rejilla que usan las pantallas
 * reales. Un esqueleto que no coincide con lo que llega después es peor que un
 * spinner, porque promete una disposición y entrega otra.
 *
 * ## Un solo anuncio, no veinte
 *
 * Cada bloque es `aria-hidden` —lo hace ya `Skeleton`— y el contenedor lleva
 * `role="status"` con un texto que dice qué se está cargando. Un lector de
 * pantalla oye una frase, no la geometría de la página.
 */

import React from 'react';
import { cn } from './cn';
import { Skeleton } from './Skeleton';

export interface PageSkeletonProps {
  /** Qué se está cargando. Es lo único que oye un lector de pantalla. */
  label: string;
  /** Reserva el bloque de título y subtítulo de la cabecera. */
  header?: boolean;
  /** Cuántas tarjetas de KPI reservar, en la rejilla de cuatro columnas. */
  tiles?: number;
  /** Cuántos paneles altos reservar debajo. */
  panels?: number;
  /** Reserva la banda alta de una cabecera héroe, sobre las tarjetas. */
  hero?: boolean;
  className?: string;
}

export const PageSkeleton: React.FC<PageSkeletonProps> = ({
  label,
  header = true,
  tiles = 4,
  panels = 2,
  hero = false,
  className,
}) => (
  <div className={cn('space-y-4', className)} role="status" aria-busy="true" aria-label={label}>
    {header && (
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-3 w-full max-w-xl" />
      </div>
    )}

    {hero && <Skeleton className="h-52 w-full rounded-3xl" />}

    {tiles > 0 && (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: tiles }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-2xl" />
        ))}
      </div>
    )}

    {panels > 0 && (
      <div className="space-y-4">
        {Array.from({ length: panels }, (_, index) => (
          // El primer panel es más alto porque en todas estas pantallas el
          // primero es el que lleva el contenido principal. Una pila de bloques
          // idénticos describe una página que no existe.
          <Skeleton key={index} className={cn('w-full rounded-2xl', index === 0 ? 'h-64' : 'h-40')} />
        ))}
      </div>
    )}
  </div>
);

export default PageSkeleton;

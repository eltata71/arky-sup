/**
 * A semantic state, rendered so that colour is never the only thing carrying
 * it.
 *
 * ## The shape carries the meaning, not only the hue
 *
 * WCAG 1.4.1 is the rule — information must not be conveyed by colour alone —
 * and a legend elsewhere on the page does not satisfy it when the dot appears
 * in a table row the reader is scanning. So the **four severities that appear
 * together in one list** each get a silhouette that survives greyscale, a
 * colour-blind reader and a bad projector:
 *
 * | tone | silhouette |
 * |---|---|
 * | `success` | disc |
 * | `warning` | diamond |
 * | `risk` | square |
 * | `critical` | triangle — the universal danger outline |
 *
 * `info`, `neutral` and `ai` are **categories, not severities**: they never
 * appear inside a severity ranking, so they stay disc variants (a ring, a faded
 * disc, a disc) rather than spending silhouettes that would only make the four
 * above harder to tell apart. If one of them ever has to sit in a severity
 * list, it needs its own outline before it does.
 *
 * Every shape fits the same 10×10 box. A tone that grew its own box would push
 * the label beside it out of alignment, and a column of dots that do not line
 * up is harder to scan than one colour.
 *
 * The hues are the ones already validated for this product in
 * `officeChartTokens.ts` — the same red, indigo, amber and emerald, at the same
 * steps in each theme. A second, unvalidated status palette living beside a
 * validated one is how a dashboard ends up with two different reds.
 */

import React from 'react';
import { cn } from './cn';

export type StatusTone =
  | 'success'
  | 'warning'
  | 'risk'
  | 'critical'
  | 'info'
  | 'neutral'
  | 'ai';

interface StatusVisual {
  /** The dot's fill. */
  surface: string;
  /** Ink for an accompanying label, at ≥4.5:1 on the page surface. */
  ink: string;
  /** Soft tint for a row or chip carrying this state. */
  wash: string;
  /** Border for that same chip. */
  edge: string;
  /** The shape class — the redundant encoding colour alone cannot give. */
  shape: string;
  /** Default written label, so a bare dot still has an accessible name. */
  label: string;
}

export const STATUS_VISUALS: Readonly<Record<StatusTone, StatusVisual>> = Object.freeze({
  success: {
    surface: 'bg-[#059669]',
    ink: 'text-[#047857] dark:text-[#34d399]',
    wash: 'bg-emerald-50 dark:bg-emerald-950/30',
    edge: 'border-emerald-200 dark:border-emerald-900/60',
    shape: 'rounded-full',
    label: 'Correcto',
  },
  warning: {
    surface: 'bg-[#d97706]',
    ink: 'text-[#b45309] dark:text-[#f59e0b]',
    wash: 'bg-amber-50 dark:bg-amber-950/30',
    edge: 'border-amber-200 dark:border-amber-900/60',
    // A diamond: distinguishable from the disc at 8px even in greyscale.
    // Rombo: distinguible del disco a 10 px incluso en escala de grises.
    shape: 'rounded-[1px] rotate-45 scale-90',
    label: 'Atención',
  },
  risk: {
    surface: 'bg-[#ea580c]',
    ink: 'text-[#c2410c] dark:text-[#fb923c]',
    wash: 'bg-orange-50 dark:bg-orange-950/30',
    edge: 'border-orange-200 dark:border-orange-900/60',
    shape: 'rounded-[2px]',
    label: 'En riesgo',
  },
  critical: {
    surface: 'bg-[#dc2626] dark:bg-[#ef4444]',
    ink: 'text-[#dc2626] dark:text-[#ef4444]',
    wash: 'bg-red-50 dark:bg-red-950/30',
    edge: 'border-red-200 dark:border-red-900/60',
    // Triángulo: la silueta universal de peligro, y la única de las cuatro que
    // se reconoce por su contorno sin necesidad de comparar con las demás.
    shape: '[clip-path:polygon(50%_0%,100%_100%,0%_100%)]',
    label: 'Crítico',
  },
  info: {
    surface: 'bg-[#4f46e5] dark:bg-[#6366f1]',
    ink: 'text-[#4f46e5] dark:text-[#818cf8]',
    wash: 'bg-primary-50 dark:bg-primary-950/30',
    edge: 'border-primary-200 dark:border-primary-900/60',
    shape: 'rounded-full ring-2 ring-inset ring-white/70 dark:ring-gray-900/70',
    label: 'En curso',
  },
  neutral: {
    surface: 'bg-[#a1a1aa] dark:bg-[#52525b]',
    ink: 'text-gray-500 dark:text-gray-400',
    wash: 'bg-gray-50 dark:bg-gray-900/60',
    edge: 'border-gray-200 dark:border-gray-800',
    shape: 'rounded-full opacity-70',
    label: 'Sin actividad',
  },
  ai: {
    surface: 'bg-[#c026d3] dark:bg-[#e879f9]',
    ink: 'text-[#a21caf] dark:text-[#f0abfc]',
    wash: 'bg-ai-50 dark:bg-ai-950/30',
    edge: 'border-ai-200 dark:border-ai-900/60',
    shape: 'rounded-full',
    label: 'Actividad de IA',
  },
});

export interface StatusDotProps {
  tone: StatusTone;
  /**
   * The written state. Rendered beside the dot when `showLabel`, and used as
   * the dot's accessible name otherwise — a dot with no name is a decoration
   * that happens to carry the row's most important fact.
   */
  label?: string;
  /** Render the label as visible text next to the dot. */
  showLabel?: boolean;
  /**
   * Animate the dot. Reserved for a state that is *changing right now* — a task
   * running, an agent thinking. A pulse on a static state is noise that never
   * stops, and `prefers-reduced-motion` switches it off.
   */
  pulse?: boolean;
  className?: string;
}

export const StatusDot: React.FC<StatusDotProps> = ({
  tone,
  label,
  showLabel = false,
  pulse = false,
  className,
}) => {
  const visual = STATUS_VISUALS[tone];
  const text = label ?? visual.label;

  const dot = (
    <span className={cn('relative inline-flex h-2.5 w-2.5 shrink-0', className)}>
      {pulse && (
        <span
          className={cn(
            'absolute inset-0 opacity-60 motion-safe:animate-ping motion-reduce:hidden',
            visual.surface,
            visual.shape,
          )}
          aria-hidden
        />
      )}
      <span className={cn('relative h-full w-full', visual.surface, visual.shape)} aria-hidden />
    </span>
  );

  if (!showLabel) {
    // The dot alone still has to say what it means: the shape and hue are for
    // sighted readers, this is the same fact for everyone else.
    return (
      <span className="inline-flex items-center">
        {dot}
        <span className="sr-only">{text}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      {dot}
      <span className={cn('text-2xs font-semibold', visual.ink)}>{text}</span>
    </span>
  );
};

export default StatusDot;

/**
 * A stat tile — the right form when the answer is one number.
 *
 * The figure leads, the label explains it, and the optional qualifiers say
 * where it is heading. Deliberately *not* a chart: a single value plotted as a
 * bar is a number wearing a costume.
 *
 * ## What a KPI is allowed to claim
 *
 * A figure on an executive screen is read as a fact, so the three qualifiers
 * this tile can carry are each guarded:
 *
 * - **`delta` states a change against a stated baseline.** `since` is required
 *   with it, because "+3" with nothing to compare against is not a change, it
 *   is a second number pretending to be one.
 * - **Direction is not a value judgement.** `goodDirection` says which way is
 *   good for *this* measure, because falling risk and falling delivery are the
 *   same arrow and opposite news. Without it the delta is drawn neutral rather
 *   than guessing.
 * - **`trend` is a shape, never a claim.** It is the `Sparkline`, which is
 *   `aria-hidden`: at 24px tall it has no readable values, and a screen reader
 *   announcing a shape it cannot describe adds length and nothing else. A
 *   caller that draws one owes the reader the same movement in words, in
 *   `delta` or in `hint`.
 */

import React from 'react';
import { cn } from '../cn';
import { ArrowDownRight, ArrowRight, ArrowUpRight, type LucideIcon } from 'lucide-react';
import { Sparkline } from './Sparkline';

export type StatTileTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'ai';

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  /** Small clarifying line under the value. */
  hint?: string;
  icon?: LucideIcon;
  tone?: StatTileTone;
  /** Optional 0..1 meter drawn under the value. */
  meter?: number;
  /**
   * The change against `since`. Positive means the figure rose — whether that
   * is good news is `goodDirection`'s business, not the sign's.
   */
  delta?: number;
  /** What the delta is measured against. Required whenever `delta` is given. */
  since?: string;
  /**
   * Which direction is good for this measure. Omit when the measure has no
   * good direction — a count of open initiatives is neither.
   */
  goodDirection?: 'up' | 'down';
  /** Recent values, oldest first, drawn as a sparkline. Two or more, or none. */
  trend?: readonly number[];
  /** Turns the whole tile into a filter/drill-down control. */
  onClick?: () => void;
  /** Marks the tile as the active filter. */
  active?: boolean;
  className?: string;
}

/**
 * Surfaces for the tones that *demand action*.
 *
 * Deliberately absent for neutral, primary and success: if every tile is
 * tinted, none of them stands out, and the row goes back to reading as five
 * equal numbers. A finding — "3 proyectos sin iniciativa" — has to be
 * distinguishable from a count at a glance, which is the whole job of a KPI
 * row. Tinting only the two states that need a human is what buys that.
 */
const ALERT_SURFACES: Partial<Record<StatTileTone, string>> = {
  warning: 'border-amber-300 bg-amber-50/60 dark:border-amber-900/70 dark:bg-amber-950/25',
  danger: 'border-red-300 bg-red-50/60 dark:border-red-900/70 dark:bg-red-950/25',
};

/**
 * On a tinted surface the standard label ink measures 4.57:1 — over the 4.5
 * floor, but with almost no margin, and this is small uppercase text on exactly
 * the tiles a reader must not miss. A step darker takes it past 6:1.
 */
const ALERT_LABEL_INK = 'text-gray-600 dark:text-gray-300';

/**
 * Each tone's surfaces. `spark`/`sparkInk` exist so the sparkline is drawn in
 * the tile's own hue rather than a fixed indigo — a red tile with an indigo
 * trend line reads as two unrelated facts stacked in one box.
 */
const toneStyles: Record<StatTileTone, { icon: string; meter: string; ring: string; spark: string; sparkInk: string }> = {
  neutral: {
    icon: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
    meter: 'bg-gray-400 dark:bg-gray-500',
    ring: 'ring-gray-300 dark:ring-gray-600',
    spark: 'stroke-gray-400 dark:stroke-gray-500',
    sparkInk: 'text-gray-400 dark:text-gray-500',
  },
  primary: {
    icon: 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300',
    meter: 'bg-[#4f46e5] dark:bg-[#6366f1]',
    ring: 'ring-primary-400',
    spark: 'stroke-[#4f46e5] dark:stroke-[#818cf8]',
    sparkInk: 'text-[#4f46e5] dark:text-[#818cf8]',
  },
  success: {
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    meter: 'bg-[#059669]',
    ring: 'ring-emerald-400',
    spark: 'stroke-[#059669] dark:stroke-[#34d399]',
    sparkInk: 'text-[#059669] dark:text-[#34d399]',
  },
  warning: {
    icon: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    meter: 'bg-[#d97706]',
    ring: 'ring-amber-400',
    spark: 'stroke-[#d97706] dark:stroke-[#fbbf24]',
    sparkInk: 'text-[#d97706] dark:text-[#fbbf24]',
  },
  danger: {
    icon: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    meter: 'bg-[#dc2626] dark:bg-[#ef4444]',
    ring: 'ring-red-400',
    spark: 'stroke-[#dc2626] dark:stroke-[#ef4444]',
    sparkInk: 'text-[#dc2626] dark:text-[#ef4444]',
  },
  ai: {
    icon: 'bg-ai-100 text-ai-700 dark:bg-ai-900/40 dark:text-ai-300',
    meter: 'bg-ai-500',
    ring: 'ring-ai-400',
    spark: 'stroke-[#c026d3] dark:stroke-[#e879f9]',
    sparkInk: 'text-[#c026d3] dark:text-[#e879f9]',
  },
};

export const StatTile: React.FC<StatTileProps> = ({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  meter,
  delta,
  since,
  goodDirection,
  trend,
  onClick,
  active = false,
  className,
}) => {
  const palette = toneStyles[tone];
  const Component = onClick ? 'button' : 'div';

  // A flat delta gets the neutral arrow and neutral ink: "no change" is a
  // result, and colouring it would make standing still look like an outcome.
  const rising = (delta ?? 0) > 0;
  const flat = (delta ?? 0) === 0;
  const DeltaGlyph = flat ? ArrowRight : rising ? ArrowUpRight : ArrowDownRight;
  const deltaInk = flat || !goodDirection
    ? 'text-gray-500 dark:text-gray-400'
    : (rising ? goodDirection === 'up' : goodDirection === 'down')
      ? 'text-[#047857] dark:text-[#34d399]'
      : 'text-[#b45309] dark:text-[#fbbf24]';

  return (
    <Component
      {...(onClick ? { type: 'button' as const, onClick, 'aria-pressed': active } : {})}
      className={cn(
        'rounded-2xl border p-4 text-left shadow-sm transition-all',
        ALERT_SURFACES[tone] ?? 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900',
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        active && cn('ring-2', palette.ring),
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={cn(
          'text-2xs font-semibold uppercase tracking-widest-2',
          ALERT_SURFACES[tone] ? ALERT_LABEL_INK : 'text-gray-500 dark:text-gray-400',
        )}>
          {label}
        </p>
        {Icon && (
          <span className={cn('inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', palette.icon)}>
            <Icon className="h-4 w-4" aria-hidden strokeWidth={2} />
          </span>
        )}
      </div>

      <div className="mt-2 flex items-end justify-between gap-2">
        <p className="text-2xl font-bold leading-none tracking-tight tabular-nums text-gray-900 dark:text-gray-50">
          {value}
        </p>
        {trend && trend.length >= 2 && (
          <Sparkline
            values={trend}
            stroke={palette.spark}
            fillInk={palette.sparkInk}
            width={72}
            height={24}
            className="mb-0.5 shrink-0"
          />
        )}
      </div>

      {typeof delta === 'number' && since && (
        <p className={cn('mt-1.5 inline-flex items-center gap-1 text-2xs font-semibold', deltaInk)}>
          <DeltaGlyph className="h-3 w-3" aria-hidden strokeWidth={2.5} />
          <span className="tabular-nums">{delta > 0 ? `+${delta}` : delta}</span>
          <span className="font-medium text-gray-500 dark:text-gray-400">{since}</span>
        </p>
      )}

      {/*
        Decorative. The tile's value is the same ratio in words right above it,
        so a progressbar named after the tile made VoiceOver announce the label,
        the number, and then the label and number again. The meter is a visual
        restatement, and it is marked as one.
      */}
      {typeof meter === 'number' && (
        <div
          className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
          aria-hidden
        >
          <div
            className={cn('h-full rounded-full transition-all duration-500', palette.meter)}
            style={{ width: `${Math.round(Math.max(0, Math.min(1, meter)) * 100)}%` }}
          />
        </div>
      )}

      {hint && (
        <p className="mt-1.5 text-2xs leading-snug text-gray-500 dark:text-gray-400">{hint}</p>
      )}
    </Component>
  );
};

export default StatTile;

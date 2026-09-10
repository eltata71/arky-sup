/**
 * A gauge — one ratio, drawn as an arc, when that ratio *is* the headline.
 *
 * The one form the chart set was missing, and the reason it is not a donut: a
 * donut answers "how is this whole divided", a gauge answers "how far along a
 * known scale is this one number". Portfolio health is the second question, and
 * drawing it as a two-segment donut ("healthy" vs "the rest") invents a
 * category — "the rest" — that means nothing on its own.
 *
 * It is a 270° arc rather than a full ring so the gap reads as the *scale*: a
 * full circle at 90 % and a full circle at 100 % differ by a sliver most
 * readers cannot judge, while an arc with a visible start and end gives the eye
 * two anchors to measure against.
 *
 * ## Honesty rules, the same three this product applies everywhere
 *
 * - **`null` is not zero.** A gauge handed `null` draws its track and says the
 *   value is not measured. Painting 0 % over an unmeasured portfolio reports an
 *   organisation that has achieved nothing.
 * - **Derived is distinguishable from declared.** `caption` is where the caller
 *   says which it is, and it is rendered as part of the figure, not as a
 *   footnote elsewhere.
 * - **The band is written, not only coloured.** `bandLabel` names where the
 *   value sits, because an arc's hue is exactly the kind of meaning WCAG 1.4.1
 *   refuses to let colour carry alone.
 */

import React from 'react';
import { cn } from '../cn';

export interface RadialGaugeProps {
  /**
   * The ratio, 0..1 — or `null` when nobody has measured it. The two are
   * different facts and the gauge renders them differently.
   */
  value: number | null;
  /** What the arc measures. Becomes the accessible name. */
  title: string;
  /** The figure in the middle. Defaults to the value as a percentage. */
  displayValue?: React.ReactNode;
  /** The line under the figure: what it is, or where it came from. */
  caption?: string;
  /** The written name of the band the value falls in. Never colour alone. */
  bandLabel?: string;
  /** Arc colour, as Tailwind `stroke-*` classes for both themes. */
  stroke?: string;
  /** Ink for the band label, matching the arc. */
  ink?: string;
  /** Outer diameter in px. */
  size?: number;
  /** Arc thickness in px. */
  thickness?: number;
  className?: string;
}

/** Degrees the arc sweeps, and where it starts. A 270° dial, gap at the bottom. */
const SWEEP = 270;
const START = 135;

const polar = (cx: number, cy: number, r: number, degrees: number) => {
  const rad = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

/** An SVG arc path from `START` through `degrees` of sweep. */
const arcPath = (cx: number, cy: number, r: number, degrees: number): string => {
  // A full 360° arc cannot be drawn as one segment (start meets end), and this
  // gauge never sweeps that far — but clamping keeps a caller's 1.001 safe.
  const swept = Math.min(SWEEP, Math.max(0, degrees));
  const from = polar(cx, cy, r, START);
  const to = polar(cx, cy, r, START + swept);
  return `M ${from.x} ${from.y} A ${r} ${r} 0 ${swept > 180 ? 1 : 0} 1 ${to.x} ${to.y}`;
};

export const RadialGauge: React.FC<RadialGaugeProps> = ({
  value,
  title,
  displayValue,
  caption,
  bandLabel,
  stroke = 'stroke-[#4f46e5] dark:stroke-[#6366f1]',
  ink = 'text-[#4f46e5] dark:text-[#818cf8]',
  size = 176,
  thickness = 14,
  className,
}) => {
  const measured = typeof value === 'number' && Number.isFinite(value);
  const ratio = measured ? Math.max(0, Math.min(1, value)) : 0;
  const centre = size / 2;
  const radius = centre - thickness / 2 - 2;

  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={
          measured
            ? `${title}: ${Math.round(ratio * 100)} %${bandLabel ? `, ${bandLabel}` : ''}`
            : `${title}: sin medir`
        }
      >
        <path
          d={arcPath(centre, centre, radius, SWEEP)}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          className="stroke-gray-100 dark:stroke-gray-800"
        />
        {measured && (
          <path
            d={arcPath(centre, centre, radius, SWEEP * ratio)}
            fill="none"
            strokeWidth={thickness}
            strokeLinecap="round"
            className={cn(stroke, 'transition-[d] duration-500')}
          />
        )}
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <span
          className={cn(
            'font-bold tabular-nums leading-none tracking-tight',
            measured ? 'text-3xl text-gray-900 dark:text-gray-50' : 'text-xl text-gray-400 dark:text-gray-500',
          )}
        >
          {measured ? (displayValue ?? `${Math.round(ratio * 100)}%`) : 'Sin medir'}
        </span>
        {bandLabel && measured && (
          <span className={cn('mt-1.5 text-2xs font-bold uppercase tracking-widest-2', ink)}>
            {bandLabel}
          </span>
        )}
        {caption && (
          <span className="mt-1 text-2xs leading-snug text-gray-500 dark:text-gray-400">
            {caption}
          </span>
        )}
      </div>
    </div>
  );
};

export default RadialGauge;

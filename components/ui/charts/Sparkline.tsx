/**
 * A sparkline — a shape, not a chart.
 *
 * It sits inside a KPI tile beside the figure and answers one question the
 * figure cannot: *is this going up or down?* Deliberately stripped of axes,
 * gridlines and labels, because at 24px tall none of them would be legible and
 * all of them would compete with the number they exist to qualify. When the
 * reader needs the values, the full `TrendArea` is the form to use.
 *
 * Two rules it keeps:
 *
 * - **Fewer than two points is not a trend.** One measurement drawn as a line
 *   is a horizontal stroke that reads as "flat" — a claim the data does not
 *   support. It renders nothing instead.
 * - **A flat series is drawn flat, at the middle.** When every value is equal
 *   there is no range to scale against; the line sits centred rather than
 *   pinned to the floor, which would read as zero.
 *
 * It is `aria-hidden` and that is correct rather than lazy: the tile already
 * states the value and the trend in words, and a screen reader announcing a
 * shape it cannot describe adds nothing but length. Nothing is announced twice.
 */

import React, { useId } from 'react';
import { cn } from '../cn';

export interface SparklineProps {
  /** Oldest first. Fewer than two and nothing is drawn. */
  values: readonly number[];
  /** Tailwind `stroke-*` classes for both themes. */
  stroke?: string;
  /** Tailwind `text-*` classes — the gradient under the line reads from these. */
  fillInk?: string;
  width?: number;
  height?: number;
  /** Draw a dot on the most recent point, which is the one being reported. */
  markLast?: boolean;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  values,
  stroke = 'stroke-[#4f46e5] dark:stroke-[#818cf8]',
  fillInk = 'text-[#4f46e5] dark:text-[#818cf8]',
  width = 96,
  height = 28,
  markLast = true,
  className,
}) => {
  const gradientId = useId();

  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const padding = 2;
  const usable = height - padding * 2;

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    // A flat series has no range: centre it rather than pin it to the floor.
    const y = span === 0
      ? padding + usable / 2
      : padding + usable - ((value - min) / span) * usable;
    return { x, y };
  });

  const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const last = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', fillInk, className)}
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={line}
        fill="none"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={stroke}
      />
      {markLast && (
        <circle cx={last.x} cy={last.y} r={2.25} className={cn(stroke, 'fill-white dark:fill-gray-900')} strokeWidth={1.5} />
      )}
    </svg>
  );
};

export default Sparkline;

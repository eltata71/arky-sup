/**
 * Donut — the mix of a whole, with the total as the hero figure in the middle.
 *
 * Used for "how is the portfolio distributed across states". Segments render in
 * the caller's order, which for office health is a validated colour order; a 2px
 * surface gap separates adjacent arcs so no two fills ever touch, and every
 * segment is named in the legend beside its value.
 */

import React from 'react';
import { cn } from '../cn';
import { ChartEmptyState } from './ChartEmptyState';
import { sumSegments, type ChartSegment } from './chartTypes';

export interface DonutChartProps {
  segments: ChartSegment[];
  /**
   * Shown instead of the ring when every segment is zero. Without it the
   * donut draws an empty circle and a legend of zeros — a chart of nothing.
   */
  emptyMessage?: string;
  /** Big number in the hole. Defaults to the total. */
  centerValue?: React.ReactNode;
  /** Small caption under the hero figure. */
  centerLabel?: string;
  /** Outer diameter in px. */
  size?: number;
  /** Ring thickness in px. */
  thickness?: number;
  /** Accessible description of what the donut shows. */
  title: string;
  className?: string;
}

export const DonutChart: React.FC<DonutChartProps> = ({
  segments,
  centerValue,
  centerLabel,
  size = 168,
  thickness = 18,
  title,
  emptyMessage,
  className,
}) => {
  const total = sumSegments(segments);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  // The gap is carved out of each arc, so segments never share an edge.
  const gap = total > 1 ? 2 : 0;
  const visible = segments.filter((segment) => segment.value > 0);

  let cursor = 0;

  if (total === 0 && emptyMessage) {
    return <ChartEmptyState message={emptyMessage} className={className} />;
  }

  return (
    <div className={cn('flex flex-col items-center gap-4 sm:flex-row sm:items-center', className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={title}
          className="-rotate-90"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            strokeWidth={thickness}
            className="stroke-gray-100 dark:stroke-gray-800"
          />
          {total > 0 && visible.map((segment) => {
            const fraction = Math.max(0, segment.value) / total;
            const length = Math.max(0, fraction * circumference - gap);
            const offset = -cursor;
            cursor += fraction * circumference;
            return (
              <circle
                key={segment.id}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={thickness}
                strokeDasharray={`${length} ${circumference - length}`}
                strokeDashoffset={offset}
                className={cn(segment.stroke, 'transition-all duration-500')}
              >
                <title>{`${segment.label}: ${segment.value}`}</title>
              </circle>
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-50">
            {centerValue ?? total}
          </span>
          {centerLabel && (
            <span className="mt-0.5 text-2xs uppercase tracking-widest-2 font-semibold text-gray-500 dark:text-gray-400">
              {centerLabel}
            </span>
          )}
        </div>
      </div>

      {/* The legend is the relief for the sub-3:1 slots and the CVD warn pair:
          name and number are always readable without resolving a hue. */}
      <ul className="min-w-0 flex-1 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.id} className="flex items-center gap-2">
            <span className={cn('h-2.5 w-2.5 shrink-0 rounded-sm', segment.surface)} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-300">
              {segment.label}
            </span>
            <span className="text-xs font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {segment.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default DonutChart;

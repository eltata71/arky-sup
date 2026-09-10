/**
 * A single horizontal stacked bar — the compact form of "what is this made of",
 * dense enough to sit inside a portfolio row without stealing the page.
 *
 * Segments keep the caller's order (for office health, a validated colour
 * order), each fill is separated from the next by a 2px surface gap, and the
 * legend below names every segment with its value.
 */

import React from 'react';
import { cn } from '../cn';
import { sumSegments, type ChartSegment } from './chartTypes';

export interface StackedBarProps {
  segments: ChartSegment[];
  /** Accessible description of what the bar shows. */
  title: string;
  /** Bar height in px. Thin by default — the data is the point, not the mark. */
  height?: number;
  /** Render the name/value legend under the bar. */
  showLegend?: boolean;
  className?: string;
}

export const StackedBar: React.FC<StackedBarProps> = ({
  segments,
  title,
  height = 8,
  showLegend = true,
  className,
}) => {
  const total = sumSegments(segments);
  const visible = segments.filter((segment) => segment.value > 0);

  return (
    <div className={cn('space-y-2', className)}>
      <div
        className="flex w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
        style={{ height }}
        role="img"
        aria-label={`${title}. ${segments.map((s) => `${s.label}: ${s.value}`).join('. ')}`}
      >
        {total > 0 && visible.map((segment, index) => (
          <div
            key={segment.id}
            className={cn(
              segment.surface,
              'h-full transition-all duration-500',
              // The 2px surface gap: adjacency must never be the only separator
              // between two fills.
              index > 0 && 'ml-0.5',
            )}
            style={{ width: `${(Math.max(0, segment.value) / total) * 100}%` }}
            title={`${segment.label}: ${segment.value}`}
          />
        ))}
      </div>

      {showLegend && (
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {visible.map((segment) => (
            <li key={segment.id} className="inline-flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-sm', segment.surface)} aria-hidden />
              <span className="text-2xs text-gray-500 dark:text-gray-400">{segment.label}</span>
              <span className="text-2xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                {segment.value}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default StackedBar;

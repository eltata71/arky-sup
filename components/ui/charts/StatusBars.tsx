/**
 * Ranked status bars — several named quantities compared against the largest of
 * them, each carrying its own state.
 *
 * The form to reach for when the question is *"where is the trouble
 * concentrated?"*. A donut would answer a different one (how a whole divides),
 * and a donut of risks implies the risks add up to something, which they do
 * not: three critical risks and forty low ones are not 43 of anything.
 *
 * Scaled against the maximum rather than the sum, for the same reason. The bar
 * says "this row against the worst row", which is the comparison a reader
 * actually makes when triaging.
 */

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../cn';
import { ChartEmptyState } from './ChartEmptyState';

export interface StatusBarRow {
  id: string;
  /** Always rendered. Colour never carries the meaning alone. */
  label: string;
  value: number;
  /** Tailwind `bg-*` classes for the filled track. */
  surface: string;
  /** Tailwind `text-*` classes for the value and the icon. */
  ink: string;
  icon?: LucideIcon;
  /** One line explaining what this row counts. */
  hint?: string;
  /** Makes the whole row a drill-down control. */
  onSelect?: () => void;
}

export interface StatusBarsProps {
  rows: readonly StatusBarRow[];
  /** Accessible description of the comparison. */
  title: string;
  /** Shown instead of empty tracks when every row is zero. */
  emptyMessage?: string;
  /** Word for the unit, used in each row's accessible name. */
  unit?: string;
  className?: string;
}

export const StatusBars: React.FC<StatusBarsProps> = ({
  rows,
  title,
  emptyMessage,
  unit = '',
  className,
}) => {
  const max = rows.reduce((highest, row) => Math.max(highest, row.value), 0);

  if (max === 0 && emptyMessage) {
    return <ChartEmptyState message={emptyMessage} className={className} />;
  }

  return (
    <ul className={cn('space-y-2', className)} aria-label={title}>
      {rows.map((row) => {
        const Icon = row.icon;
        const width = max === 0 ? 0 : Math.max(row.value > 0 ? 4 : 0, (row.value / max) * 100);
        const Row = row.onSelect ? 'button' : 'div';
        return (
          <li key={row.id}>
            <Row
              {...(row.onSelect
                ? {
                    type: 'button' as const,
                    onClick: row.onSelect,
                    // The row already reads "Riesgos críticos, 3": the bar is a
                    // restatement of the number, so it carries no name of its own.
                    'aria-label': `${row.label}: ${row.value}${unit ? ` ${unit}` : ''}`,
                  }
                : {})}
              className={cn(
                'w-full rounded-lg px-2 py-1.5 text-left transition-colors',
                row.onSelect
                  && 'hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-800/60',
              )}
            >
              <div className="flex items-center gap-2">
                {Icon && <Icon className={cn('h-3.5 w-3.5 shrink-0', row.ink)} aria-hidden strokeWidth={2} />}
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-gray-700 dark:text-gray-200">
                  {row.label}
                </span>
                <span className={cn('text-sm font-bold tabular-nums', row.value > 0 ? row.ink : 'text-gray-400 dark:text-gray-600')}>
                  {row.value}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden>
                <div
                  className={cn('h-full rounded-full transition-[width] duration-500', row.surface)}
                  style={{ width: `${width}%` }}
                />
              </div>
              {row.hint && (
                <p className="mt-1 text-2xs leading-snug text-gray-500 dark:text-gray-400">{row.hint}</p>
              )}
            </Row>
          </li>
        );
      })}
    </ul>
  );
};

export default StatusBars;

/**
 * What a chart shows when there is nothing to plot.
 *
 * A donut whose total is zero draws an empty ring, a "0" in the middle and a
 * legend of five zeros; ranked bars with every value at zero draw five empty
 * tracks. Both are charts *of nothing*: they occupy the space and authority of
 * a figure while carrying no information, and they read as a rendering fault
 * rather than as an accurate report of an empty portfolio.
 *
 * The honest alternative states the fact and, where the caller knows it, what
 * would put data here. Only the caller knows that — the chart sees numbers, not
 * a domain — so the message is a prop.
 */

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../cn';

export interface ChartEmptyStateProps {
  /** One sentence: what is empty, and what would fill it. */
  message: string;
  icon?: LucideIcon;
  className?: string;
}

export const ChartEmptyState: React.FC<ChartEmptyStateProps> = ({ message, icon: Icon, className }) => (
  <div
    className={cn(
      'flex min-h-[132px] flex-col items-center justify-center gap-2 rounded-xl',
      'border border-dashed border-gray-200 px-5 py-6 text-center dark:border-gray-800',
      className,
    )}
  >
    {Icon && <Icon className="h-5 w-5 text-gray-300 dark:text-gray-600" aria-hidden strokeWidth={1.75} />}
    <p className="max-w-[36ch] text-xs leading-relaxed text-gray-500 dark:text-gray-400">{message}</p>
  </div>
);

export default ChartEmptyState;

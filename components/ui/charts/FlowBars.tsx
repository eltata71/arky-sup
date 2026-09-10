/**
 * The work pipeline as ranked horizontal bars — how much sits in each stage.
 *
 * Horizontal because the stage names are words, and words read horizontally;
 * ranked bars beat a funnel graphic because the widths stay comparable when a
 * later stage holds more than an earlier one, which happens constantly when
 * reviewers send work back.
 */

import React from 'react';
import { cn } from '../cn';
import { ChartEmptyState } from './ChartEmptyState';
import type { LucideIcon } from 'lucide-react';

export interface FlowStage {
  id: string;
  label: string;
  value: number;
  /** Tailwind `bg-*` classes for the bar. */
  surface: string;
  /** Tailwind `text-*` classes for the glyph. */
  ink: string;
  icon: LucideIcon;
  /** Optional click-through, e.g. to filter the board by this stage. */
  onSelect?: () => void;
}

export interface FlowBarsProps {
  stages: FlowStage[];
  title: string;
  /** Shown instead of the tracks when every stage is zero. */
  emptyMessage?: string;
  className?: string;
}

export const FlowBars: React.FC<FlowBarsProps> = ({ stages, title, emptyMessage, className }) => {
  const max = Math.max(1, ...stages.map((stage) => stage.value));
  const total = stages.reduce((sum, stage) => sum + Math.max(0, stage.value), 0);

  if (total === 0 && emptyMessage) {
    return <ChartEmptyState message={emptyMessage} className={className} />;
  }

  return (
    <ul className={cn('space-y-2.5', className)} aria-label={title}>
      {stages.map((stage) => {
        const Icon = stage.icon;
        const width = `${Math.round((stage.value / max) * 100)}%`;
        const row = (
          <>
            <span className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center', stage.ink)}>
              <Icon className="h-4 w-4" aria-hidden strokeWidth={2} />
            </span>
            <span className="w-28 shrink-0 truncate text-xs font-medium text-gray-700 dark:text-gray-200">
              {stage.label}
            </span>
            <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <span
                className={cn('block h-full rounded-full transition-all duration-500', stage.surface)}
                style={{ width }}
              />
            </span>
            <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {stage.value}
            </span>
          </>
        );

        return (
          <li key={stage.id}>
            {stage.onSelect ? (
              <button
                type="button"
                onClick={stage.onSelect}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-800/60"
              >
                {row}
              </button>
            ) : (
              <div className="flex items-center gap-2 px-1 py-0.5">{row}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default FlowBars;

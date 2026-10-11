import React from 'react';
import { cn } from './cn';
import { Skeleton } from './Skeleton';

export interface HubSkeletonProps {
  /** What is loading. It is all a screen reader hears. */
  label: string;
  /** How many rows the side list reserves. */
  rows?: number;
  /** How many cards the main grid reserves. */
  cards?: number;
  className?: string;
}

/**
 * The shape of a project's hub while it loads (13.4): a header, a side list
 * of artifacts and a grid of cards — the layout `ProjectHub` actually draws.
 * `PageSkeleton` describes a page of tiles and panels; reusing it here would
 * promise one layout and deliver another, which is worse than a spinner.
 */
export const HubSkeleton: React.FC<HubSkeletonProps> = ({ label, rows = 6, cards = 6, className }) => (
  <div className={cn('flex h-full min-h-0 flex-col gap-4 p-4 md:p-6', className)} role="status" aria-busy="true" aria-label={label}>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-8 w-80 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28 rounded-lg" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>
    </div>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,25vw)_minmax(0,1fr)]">
      <div className="hidden space-y-2 lg:block">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-xl" />
        ))}
      </div>
      <div className="grid auto-rows-min grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }, (_, index) => (
          <Skeleton key={index} className="h-40 rounded-2xl" />
        ))}
      </div>
    </div>
  </div>
);

export default HubSkeleton;

/**
 * The header of a region: an eyebrow, a title, a line saying what it is, and
 * the actions that belong to it.
 *
 * This exact block was written by hand in nineteen places — a `div` with a
 * `flex flex-wrap items-start justify-between gap-3`, a title, a `mt-0.5
 * text-xs` paragraph and a button — and the copies had drifted: three gap
 * sizes, two title weights, and paragraphs at `text-xs` in some panels and
 * `text-sm` in others. A reader cannot tell which of two panels is the more
 * important one when the difference is an accident.
 *
 * The heading level is a **required** prop rather than a default, because the
 * right one depends on where the region sits: a panel inside a page whose `h1`
 * is the page title needs an `h2`, and the same panel used inside a drawer that
 * already has one needs an `h3`. A default would silently produce the wrong
 * outline for whichever caller did not think about it, and a broken heading
 * outline is invisible to everyone except the screen-reader user navigating by
 * headings — the one person who depends on it entirely.
 */

import React from 'react';
import { cn } from './cn';
import { TYPE } from '../../lib/designTokens';

export interface SectionHeaderProps {
  /** The uppercase kicker over the title. Omit unless it adds a category. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** One line saying what this region is for. */
  description?: React.ReactNode;
  /**
   * Which heading element to render. Required — see the note above.
   * `'none'` renders a `div`, for the rare header that is not a landmark.
   */
  as: 'h2' | 'h3' | 'h4' | 'none';
  /** An id, so a `section` can point `aria-labelledby` at the real title. */
  titleId?: string;
  /** An icon tile to the left of the title block. */
  icon?: React.ReactNode;
  /** Controls and buttons that act on this region. */
  actions?: React.ReactNode;
  /** Tightens the block for dense panels. */
  compact?: boolean;
  className?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  eyebrow,
  title,
  description,
  as,
  titleId,
  icon,
  actions,
  compact = false,
  className,
}) => {
  const Heading = (as === 'none' ? 'div' : as) as React.ElementType;
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
        <div className="min-w-0">
          {eyebrow && <p className={TYPE.label}>{eyebrow}</p>}
          <Heading
            id={titleId}
            className={cn(
              compact ? TYPE.cardTitle : TYPE.sectionTitle,
              eyebrow && 'mt-1',
            )}
          >
            {title}
          </Heading>
          {description && (
            <p className={cn(TYPE.metadata, 'mt-1 max-w-3xl')}>{description}</p>
          )}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
};

export default SectionHeader;

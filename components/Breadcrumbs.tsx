import React from 'react';
import { HomeIcon, ChevronRightIcon } from './Icons';
import { Tooltip } from './ui/Tooltip';

export interface Crumb {
  label: string;
  onClick?: () => void;
  /** Optional secondary label (e.g. version) shown after the title. */
  meta?: string;
  /** Optional icon to render to the left of the label. */
  icon?: React.ReactNode;
}

interface BreadcrumbsProps {
  crumbs: Crumb[];
  className?: string;
}

/**
 * Breadcrumb trail.  Truncates long crumb labels and exposes the full label via
 * a tooltip on hover.  The first crumb gets a Home icon; the last one is bold
 * and not interactive.
 */
export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ crumbs, className = '' }) => {
  return (
    <nav className={`flex items-center text-sm ${className}`} aria-label="Breadcrumb">
      <ol className="inline-flex items-center space-x-1 md:space-x-2 rtl:space-x-reverse">
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          const isFirst = index === 0;
          const labelEl = (
            <span className="inline-flex items-center gap-1.5 truncate max-w-[8rem] md:max-w-[12rem]">
              {isFirst && !crumb.icon && <HomeIcon className="w-4 h-4" />}
              {crumb.icon}
              <span className="truncate">{crumb.label}</span>
              {crumb.meta && (
                <span className="text-2xs font-mono text-gray-400 dark:text-gray-500">{crumb.meta}</span>
              )}
            </span>
          );
          return (
            <li key={index} className="inline-flex items-center min-w-0">
              {index > 0 && <ChevronRightIcon className="w-4 h-4 text-gray-400 mx-1 flex-shrink-0" />}
              {crumb.onClick && !isLast ? (
                <Tooltip label={crumb.label} side="bottom">
                  <button
                    onClick={crumb.onClick}
                    className="inline-flex items-center font-medium text-gray-700 hover:text-primary-600 dark:text-gray-400 dark:hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-md px-1"
                  >
                    {labelEl}
                  </button>
                </Tooltip>
              ) : (
                <Tooltip label={crumb.label} side="bottom">
                  <span className={`inline-flex items-center font-semibold px-1 ${isLast ? 'text-gray-900 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}>
                    {labelEl}
                  </span>
                </Tooltip>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

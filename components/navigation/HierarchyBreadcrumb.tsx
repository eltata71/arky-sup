/**
 * The one navigation control that makes the hierarchy legible everywhere.
 *
 *   Iniciativa de Negocio › Proyecto de Arquitectura › Entregable › Artefacto
 *
 * Two things separate it from a decorative breadcrumb. Every crumb is a real
 * link back to that level, and any crumb that has siblings becomes a switcher:
 * the architect can hop from one engagement to its neighbour, or from one
 * architecture project to another under the same business initiative, without
 * going back up and coming down again. That lateral move is the one this app
 * could not make before, and it is where most of the clicking went.
 */

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { Dropdown, cn } from '../ui';
import { HIERARCHY_ICONS } from '../architectureOffice/officeUiIcons';
import { EA_LEVELS } from '../../lib/eaTerminology';

export type HierarchyLevelKind = keyof typeof HIERARCHY_ICONS;

export interface HierarchySibling {
  id: string;
  label: string;
  /** Secondary line in the switcher, e.g. the parent's name or a status. */
  hint?: string;
  onSelect: () => void;
}

export interface HierarchyLevel {
  kind: HierarchyLevelKind;
  label: string;
  /** Navigates to this level. Omitted on the current (last) crumb. */
  onNavigate?: () => void;
  /** Siblings at this level. A switcher only appears when there are ≥2. */
  siblings?: HierarchySibling[];
  /** Id of the currently selected sibling, marked in the switcher. */
  currentId?: string;
}

export interface HierarchyBreadcrumbProps {
  levels: HierarchyLevel[];
  className?: string;
}

/** Read from the terminology module so a level cannot be named twice. */
const KIND_LABELS: Readonly<Record<HierarchyLevelKind, string>> = Object.freeze({
  program: EA_LEVELS.initiative.singular,
  project: EA_LEVELS.engagementProject.short,
  engagement: EA_LEVELS.deliverable.short,
  artifact: EA_LEVELS.artifact.singular,
  board: 'Tablero',
});

const crumbBase = 'inline-flex max-w-[14rem] items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

export const HierarchyBreadcrumb: React.FC<HierarchyBreadcrumbProps> = ({ levels, className }) => (
  <nav aria-label="Jerarquía del portafolio" className={cn('min-w-0', className)}>
    <ol className="flex flex-wrap items-center gap-0.5">
      {levels.map((level, index) => {
        const Icon = HIERARCHY_ICONS[level.kind];
        const isCurrent = index === levels.length - 1;
        const siblings = level.siblings ?? [];
        const hasSwitcher = siblings.length > 1;

        const crumb = (
          <span
            className={cn(
              crumbBase,
              isCurrent
                ? 'bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-200'
                : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100',
            )}
            title={`${KIND_LABELS[level.kind]}: ${level.label}`}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={2} />
            <span className="truncate">{level.label}</span>
          </span>
        );

        return (
          <li key={`${level.kind}-${index}`} className="flex min-w-0 items-center">
            {index > 0 && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300 dark:text-gray-700" aria-hidden />
            )}

            <span className="flex min-w-0 items-center">
              {level.onNavigate && !isCurrent ? (
                <button
                  type="button"
                  onClick={level.onNavigate}
                  className="min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                >
                  {crumb}
                </button>
              ) : (
                <span className="min-w-0" aria-current={isCurrent ? 'page' : undefined}>
                  {crumb}
                </span>
              )}

              {hasSwitcher && (
                <Dropdown
                  align="left"
                  direction="down"
                  width="lg"
                  aria-label={`Cambiar de ${KIND_LABELS[level.kind].toLowerCase()}`}
                  items={siblings.map((sibling) => ({
                    id: sibling.id,
                    label: sibling.label,
                    description: sibling.hint,
                    active: sibling.id === level.currentId,
                    onClick: sibling.onSelect,
                  }))}
                  trigger={({ toggle }) => (
                    <button
                      type="button"
                      onClick={toggle}
                      aria-label={`Cambiar de ${KIND_LABELS[level.kind].toLowerCase()}`}
                      className="ml-0.5 inline-flex h-6 w-5 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3" aria-hidden>
                        <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  </nav>
);

export default HierarchyBreadcrumb;

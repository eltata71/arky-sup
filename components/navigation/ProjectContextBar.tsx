/**
 * Closes the navigation loop between the workspace and the Office.
 *
 * From inside a project the architect could see its artifacts but had no way
 * back up: which business initiative funds this work, and which engagements of
 * the Office are producing it. This bar answers both in one line and makes each
 * answer clickable.
 */

import React from 'react';
import { Badge, cn } from '../ui';
import { HierarchyBreadcrumb, type HierarchyLevel } from './HierarchyBreadcrumb';
import { HIERARCHY_ICONS } from '../architectureOffice/officeUiIcons';
import { ENGAGEMENT_STATUS_LABELS, ENGAGEMENT_STATUS_TONES } from '../architectureOffice/officeUiLabels';
import { UNASSIGNED_PROGRAM_NAME } from '../../services/architectureOffice/domain/officePortfolio';
import type { OfficeEngagement } from '../../services/architectureOffice/domain/OfficeTypes';

export interface ProjectContextBarProps {
  projectName: string;
  /** `NEG-YYYY-NNN` codes the project declares. */
  businessProgramIds: string[];
  /** Engagements of the Office that target this project. */
  engagements: OfficeEngagement[];
  onOpenOffice: () => void;
  onOpenEngagement: (engagementId: string) => void;
  className?: string;
}

export const ProjectContextBar: React.FC<ProjectContextBarProps> = ({
  projectName,
  businessProgramIds,
  engagements,
  onOpenOffice,
  onOpenEngagement,
  className,
}) => {
  const levels: HierarchyLevel[] = [
    {
      kind: 'program',
      label: businessProgramIds[0] ?? UNASSIGNED_PROGRAM_NAME,
      onNavigate: onOpenOffice,
      currentId: businessProgramIds[0],
      siblings: businessProgramIds.map((id) => ({
        id,
        label: id,
        hint: 'Iniciativa de negocio',
        onSelect: onOpenOffice,
      })),
    },
    { kind: 'project', label: projectName },
  ];

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800',
        className,
      )}
    >
      <HierarchyBreadcrumb levels={levels} />

      {engagements.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-2xs font-semibold uppercase tracking-widest-2 text-gray-400 dark:text-gray-500">
            <HIERARCHY_ICONS.engagement className="h-3 w-3" aria-hidden />
            Entregables
          </span>
          {engagements.slice(0, 3).map((engagement) => (
            <button
              key={engagement.id}
              type="button"
              onClick={() => onOpenEngagement(engagement.id)}
              className="inline-flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1 text-2xs font-medium text-gray-700 transition-colors hover:border-primary-300 hover:text-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-primary-700 dark:hover:text-primary-300"
            >
              <span className="truncate">{engagement.title}</span>
              <Badge tone={ENGAGEMENT_STATUS_TONES[engagement.status]} size="xs">
                {ENGAGEMENT_STATUS_LABELS[engagement.status]}
              </Badge>
            </button>
          ))}
          {engagements.length > 3 && (
            <button
              type="button"
              onClick={onOpenOffice}
              className="rounded-lg px-1.5 py-1 text-2xs font-medium text-primary-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400"
            >
              y {engagements.length - 3} más
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default ProjectContextBar;

/**
 * The portfolio, as the three-level tree it actually is:
 *
 *   Iniciativa de Negocio  ›  Proyecto de Arquitectura  ›  Entregable
 *
 * Each level answers the same four questions in the same place — what is it,
 * how healthy is it, how much work does it hold, and how far along is it — so
 * drilling down never means re-learning a layout. Levels expand in place rather
 * than navigating away, which keeps the reader's position in the portfolio
 * while they look inside it.
 */

import React, { useCallback, useState } from 'react';
import { Badge, Button, EmptyState, StackedBar, cn } from '../../ui';
import { ChevronRight, FolderOpen, Layers, Plus } from 'lucide-react';
import { HEALTH_ICONS, HIERARCHY_ICONS } from '../officeUiIcons';
import { healthSegments, OFFICE_HEALTH_VISUALS, formatPercent } from '../officeChartTokens';
import {
  ENGAGEMENT_KIND_LABELS,
  ENGAGEMENT_STATUS_LABELS,
  ENGAGEMENT_STATUS_TONES,
  GATE_STATUS_LABELS,
  GATE_STATUS_TONES,
} from '../officeUiLabels';
import { summarizeEngagementProgress } from '../../../services/architectureOffice/OfficeTypes';
import type {
  ArchitectureProjectNode,
  BusinessProgramNode,
} from '../../../services/architectureOffice/officePortfolio';

export interface PortfolioExplorerProps {
  programs: BusinessProgramNode[];
  onOpenEngagement: (engagementId: string) => void;
  onOpenProject: (projectId: string) => void;
  onNewEngagement: () => void;
  /** Ids of engagements the runner is executing right now. */
  runningEngagementIds: string[];
  className?: string;
}

const HealthPill: React.FC<{ node: { health: keyof typeof OFFICE_HEALTH_VISUALS } }> = ({ node }) => {
  const visual = OFFICE_HEALTH_VISUALS[node.health];
  const Glyph = HEALTH_ICONS[node.health];
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-2xs font-semibold',
        visual.wash,
        visual.ink,
      )}
    >
      <Glyph className="h-3.5 w-3.5" aria-hidden strokeWidth={2.2} />
      {visual.label}
    </span>
  );
};

const EngagementRow: React.FC<{
  engagement: BusinessProgramNode['projects'][number]['engagements'][number];
  running: boolean;
  onOpen: () => void;
}> = ({ engagement, running, onOpen }) => {
  const progress = summarizeEngagementProgress(engagement.tasks);
  const percent = Math.round(progress.ratio * 100);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left transition-all hover:border-primary-200 hover:bg-primary-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:border-primary-800 dark:hover:bg-primary-950/30"
      >
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <HIERARCHY_ICONS.engagement className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {engagement.title}
          </span>
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <span
                className={cn(
                  'block h-full rounded-full transition-all duration-500',
                  progress.failed > 0
                    ? OFFICE_HEALTH_VISUALS.blocked.surface
                    : OFFICE_HEALTH_VISUALS.running.surface,
                )}
                style={{ width: `${percent}%` }}
              />
            </span>
            <span className="text-2xs tabular-nums text-gray-500 dark:text-gray-400">
              {progress.completed}/{progress.total} tareas · {formatPercent(progress.ratio)}
            </span>
          </span>
        </span>

        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          <Badge tone="gray" size="xs" outline>
            {ENGAGEMENT_KIND_LABELS[engagement.charter.kind]}
          </Badge>
          {engagement.gateAssessment && (
            <Badge tone={GATE_STATUS_TONES[engagement.gateAssessment.overallStatus]} size="xs">
              Gates: {GATE_STATUS_LABELS[engagement.gateAssessment.overallStatus]}
            </Badge>
          )}
          {running && <Badge tone="primary" size="xs" dot>En ejecución</Badge>}
          <Badge tone={ENGAGEMENT_STATUS_TONES[engagement.status]} size="xs">
            {ENGAGEMENT_STATUS_LABELS[engagement.status]}
          </Badge>
        </span>
      </button>
    </li>
  );
};

const ProjectBlock: React.FC<{
  node: ArchitectureProjectNode;
  runningEngagementIds: string[];
  onOpenEngagement: (id: string) => void;
  onOpenProject: (id: string) => void;
}> = ({ node, runningEngagementIds, onOpenEngagement, onOpenProject }) => {
  const [open, setOpen] = useState(node.health === 'blocked' || node.health === 'awaiting-decision');

  return (
    <div className="rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ChevronRight
            className={cn(
              'h-4 w-4 shrink-0 text-gray-400 transition-transform',
              open && 'rotate-90',
            )}
            aria-hidden
          />
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600 dark:bg-primary-950/50 dark:text-primary-300">
            <HIERARCHY_ICONS.project className="h-4 w-4" aria-hidden strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              {node.name}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-2xs text-gray-500 dark:text-gray-400">
              <span className="inline-flex items-center gap-1">
                <HIERARCHY_ICONS.engagement className="h-3 w-3" aria-hidden />
                {node.engagements.length} entregable(s)
              </span>
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3 w-3" aria-hidden />
                {node.artifactCount} artefacto(s)
              </span>
              {node.rollup.tasksTotal > 0 && (
                <span className="tabular-nums">
                  {formatPercent(node.rollup.completionRatio)} completado
                </span>
              )}
            </span>
          </span>
        </button>

        <HealthPill node={node} />

        <Button
          variant="ghost"
          size="xs"
          onClick={() => onOpenProject(node.projectId)}
          aria-label={`Abrir el espacio de trabajo de ${node.name}`}
        >
          <FolderOpen className="mr-1 h-3.5 w-3.5" aria-hidden />
          Workspace
        </Button>
      </div>

      {open && (
        <div className="border-t border-gray-100 px-2 pb-2 pt-1 dark:border-gray-800">
          {node.engagements.length === 0 ? (
            <p className="px-2 py-3 text-xs text-gray-500 dark:text-gray-400">
              Este proyecto de arquitectura todavía no tiene entregables.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {node.engagements.map((engagement) => (
                <EngagementRow
                  key={engagement.id}
                  engagement={engagement}
                  running={runningEngagementIds.includes(engagement.id)}
                  onOpen={() => onOpenEngagement(engagement.id)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

const ProgramBlock: React.FC<{
  program: BusinessProgramNode;
  defaultOpen: boolean;
  runningEngagementIds: string[];
  onOpenEngagement: (id: string) => void;
  onOpenProject: (id: string) => void;
}> = ({ program, defaultOpen, runningEngagementIds, onOpenEngagement, onOpenProject }) => {
  const [open, setOpen] = useState(defaultOpen);
  const segments = healthSegments(program.rollup.statusMix);

  return (
    <section
      className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50/60 shadow-sm dark:border-gray-800 dark:bg-gray-900/40"
      aria-label={program.name}
    >
      <div className="flex flex-wrap items-center gap-3 p-3 md:p-4">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
        >
          <ChevronRight
            className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-90')}
            aria-hidden
          />
          <span
            className={cn(
              'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
              program.isUnassigned
                ? 'bg-gray-200 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                : 'bg-ai-soft text-ai-700 dark:text-ai-300',
            )}
          >
            <HIERARCHY_ICONS.program className="h-5 w-5" aria-hidden strokeWidth={2} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold tracking-tight text-gray-900 dark:text-gray-50 md:text-base">
              {program.name}
            </span>
            <span className="mt-0.5 block text-2xs uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
              {program.isUnassigned ? 'Sin código de negocio' : 'Iniciativa de negocio'}
              {' · '}
              {program.projects.length} proyecto(s) de arquitectura
              {' · '}
              {program.rollup.engagements} entregable(s)
            </span>
          </span>
        </button>

        <div className="hidden w-40 shrink-0 sm:block">
          <StackedBar
            segments={segments}
            title={`Estado de ${program.name}`}
            showLegend={false}
            height={6}
          />
        </div>

        <HealthPill node={program} />
      </div>

      {open && (
        <div className="space-y-2 border-t border-gray-200 bg-white/60 p-2 md:p-3 dark:border-gray-800 dark:bg-gray-950/30">
          {program.projects.map((node) => (
            <ProjectBlock
              key={node.projectId}
              node={node}
              runningEngagementIds={runningEngagementIds}
              onOpenEngagement={onOpenEngagement}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export const PortfolioExplorer: React.FC<PortfolioExplorerProps> = ({
  programs,
  onOpenEngagement,
  onOpenProject,
  onNewEngagement,
  runningEngagementIds,
  className,
}) => {
  const handleNew = useCallback(() => onNewEngagement(), [onNewEngagement]);

  if (programs.length === 0) {
    return (
      <EmptyState
        title="La Oficina todavía no tiene portafolio"
        description="Abre un entregable y la Oficina propondrá un plan de entregables, asignará especialistas y ejecutará el trabajo con revisión cruzada."
        actions={<Button variant="primary" onClick={handleNew}>Nuevo entregable</Button>}
        flavor="ai"
      />
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Iniciativa de negocio › proyecto de arquitectura › entregable. Despliega cualquier nivel
          para ver lo que contiene.
        </p>
        <Button variant="ghost" size="xs" onClick={handleNew}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
          Nuevo entregable
        </Button>
      </div>

      {programs.map((program, index) => (
        <ProgramBlock
          key={program.id}
          program={program}
          // Open the loudest program by default; the rest stay collapsed so the
          // page opens as a summary rather than a wall.
          defaultOpen={index === 0}
          runningEngagementIds={runningEngagementIds}
          onOpenEngagement={onOpenEngagement}
          onOpenProject={onOpenProject}
        />
      ))}
    </div>
  );
};

export default PortfolioExplorer;

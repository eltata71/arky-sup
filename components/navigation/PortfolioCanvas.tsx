/**
 * The whole portfolio on one board.
 *
 * The explorer answers "what is inside this?" by drilling down. This answers
 * the other question — "how does it all sit together?" — by laying the three
 * levels out as columns and drawing the containment left to right:
 *
 *   Iniciativa de Negocio  →  Proyecto de Arquitectura  →  Entregable
 *
 * Hovering or focusing any card dims everything it is not related to, so the
 * chain from one business need to the work serving it becomes visible without
 * clicking. That relationship is the thing a hierarchy explorer cannot show:
 * an explorer can only ever display one branch expanded at a time.
 *
 * Scrolls horizontally inside its own container rather than stretching the
 * page, so a portfolio with thirty initiatives stays readable on a tablet.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Badge, EmptyState, cn } from '../ui';
import { Boxes, Briefcase, Landmark } from 'lucide-react';
import { EA_LEVELS } from '../../lib/eaTerminology';
import { formatPercent, OFFICE_HEALTH_VISUALS } from '../architectureOffice/officeChartTokens';
import { HEALTH_ICONS } from '../architectureOffice/officeUiIcons';
import {
  ENGAGEMENT_STATUS_LABELS,
  ENGAGEMENT_STATUS_TONES,
} from '../architectureOffice/officeUiLabels';
import {
  INITIATIVE_HEALTH_LABELS,
  INITIATIVE_STATUS_LABELS,
  initiativeHealthVisual,
} from '../businessInitiatives/initiativeUiLabels';
import { initiativeHealth } from '../../services/businessInitiatives/initiativeMetrics';
import type { BusinessInitiative } from '../../services/businessInitiatives/BusinessInitiativeTypes';
import {
  healthBucketOf,
  type ArchitectureProjectNode,
} from '../../services/architectureOffice/officePortfolio';
import { summarizeEngagementProgress } from '../../services/architectureOffice/OfficeTypes';

export interface PortfolioCanvasProps {
  initiatives: BusinessInitiative[];
  /** Architecture attentions, already rolled up by `officePortfolio`. */
  attentions: ArchitectureProjectNode[];
  onOpenInitiative: (initiativeId: string) => void;
  onOpenAttention: (projectId: string) => void;
  onOpenDeliverable: (engagementId: string) => void;
  className?: string;
}

/** Attentions with no initiative still belong on the board, in their own lane. */
const UNLINKED = '__sin-iniciativa__';

const columnHeader = 'sticky top-0 z-10 mb-2 flex items-center gap-1.5 rounded-lg bg-gray-100/90 px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-widest-2 text-gray-600 backdrop-blur dark:bg-gray-800/90 dark:text-gray-300';

export const PortfolioCanvas: React.FC<PortfolioCanvasProps> = ({
  initiatives,
  attentions,
  onOpenInitiative,
  onOpenAttention,
  onOpenDeliverable,
  className,
}) => {
  /** The initiative key currently highlighted, or `null` when nothing is hovered. */
  const [focused, setFocused] = useState<string | null>(null);

  /**
   * `businessProgramIds` carries **keys**, not codes: an initiative id where one
   * resolved, and the raw code only where it resolved to nothing. Rendering it
   * directly printed `init_346023d9-…` on the card, so it is resolved to a
   * label here.
   */
  const labelForKey = useMemo(() => {
    const byId = new Map<string, BusinessInitiative>(initiatives.map((item) => [item.id, item]));
    return (key: string): string => {
      const initiative = byId.get(key);
      if (!initiative) return key;
      return initiative.code || initiative.title;
    };
  }, [initiatives]);

  const attentionsByInitiative = useMemo(() => {
    const map = new Map<string, ArchitectureProjectNode[]>();
    for (const attention of attentions) {
      const keys = attention.businessProgramIds.length > 0
        ? attention.businessProgramIds
        : [UNLINKED];
      for (const key of keys) {
        const list = map.get(key) ?? [];
        list.push(attention);
        map.set(key, list);
      }
    }
    return map;
  }, [attentions]);

  const deliverables = useMemo(
    () => attentions.flatMap((attention) => attention.engagements.map((engagement) => ({
      engagement,
      attention,
      keys: attention.businessProgramIds.length > 0 ? attention.businessProgramIds : [UNLINKED],
    }))),
    [attentions],
  );

  const unlinked = attentionsByInitiative.get(UNLINKED) ?? [];

  /** A card is dimmed when something else is focused and it is unrelated. */
  const dimmed = useCallback(
    (keys: readonly string[]) => focused !== null && !keys.includes(focused),
    [focused],
  );

  const cardBase = 'w-full rounded-xl border p-2.5 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500';

  if (initiatives.length === 0 && attentions.length === 0) {
    return (
      <EmptyState
        title="El portafolio todavía está vacío"
        description="Registra una iniciativa de negocio y abre el proyecto de arquitectura que la sirva. El canvas mostrará la cadena completa."
        flavor="ai"
        className={className}
      />
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {EA_LEVELS.initiative.short} → {EA_LEVELS.engagementProject.short} → {EA_LEVELS.deliverable.short}.
        Pasa el cursor por cualquier tarjeta para resaltar su cadena completa.
      </p>

      <div
        className="overflow-x-auto rounded-2xl border border-gray-200 bg-gray-50/60 p-3 dark:border-gray-800 dark:bg-gray-900/40"
        onMouseLeave={() => setFocused(null)}
      >
        <div className="grid min-w-[52rem] grid-cols-3 gap-3">
          {/* Level 1 — the need */}
          <section aria-label={EA_LEVELS.initiative.plural}>
            <h3 className={columnHeader}>
              <Landmark className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
              {EA_LEVELS.initiative.plural}
              <span className="ml-auto tabular-nums">{initiatives.length}</span>
            </h3>
            <div className="space-y-2">
              {initiatives.map((initiative) => {
                const health = initiativeHealth(initiative);
                const visual = initiativeHealthVisual(health);
                const keys = [initiative.id];
                return (
                  <button
                    key={initiative.id}
                    type="button"
                    onClick={() => onOpenInitiative(initiative.id)}
                    onMouseEnter={() => setFocused(initiative.id)}
                    onFocus={() => setFocused(initiative.id)}
                    className={cn(
                      cardBase,
                      'border-gray-200 bg-white hover:border-primary-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900',
                      dimmed(keys) && 'opacity-30',
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                          {initiative.title}
                        </span>
                        {initiative.code && (
                          <span className="block font-mono text-2xs text-gray-500 dark:text-gray-400">
                            {initiative.code}
                          </span>
                        )}
                      </span>
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', visual.surface)} aria-hidden />
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className={cn('text-2xs font-medium', visual.ink)}>
                        {INITIATIVE_HEALTH_LABELS[health]}
                      </span>
                      <span className="text-2xs text-gray-400 dark:text-gray-500">
                        · {INITIATIVE_STATUS_LABELS[initiative.status]}
                      </span>
                      <span className="ml-auto text-2xs tabular-nums text-gray-500 dark:text-gray-400">
                        {(attentionsByInitiative.get(initiative.id) ?? []).length} at.
                      </span>
                    </span>
                  </button>
                );
              })}
              {initiatives.length === 0 && (
                <p className="rounded-lg bg-white px-2.5 py-2 text-2xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  Sin iniciativas registradas.
                </p>
              )}
            </div>
          </section>

          {/* Level 2 — the architecture response */}
          <section aria-label={EA_LEVELS.engagementProject.plural}>
            <h3 className={columnHeader}>
              <Boxes className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
              {EA_LEVELS.engagementProject.shortPlural}
              <span className="ml-auto tabular-nums">{attentions.length}</span>
            </h3>
            <div className="space-y-2">
              {attentions.map((attention) => {
                const keys = attention.businessProgramIds.length > 0
                  ? attention.businessProgramIds
                  : [UNLINKED];
                const visual = OFFICE_HEALTH_VISUALS[attention.health];
                const Glyph = HEALTH_ICONS[attention.health];
                return (
                  <button
                    key={attention.projectId}
                    type="button"
                    onClick={() => onOpenAttention(attention.projectId)}
                    onMouseEnter={() => setFocused(keys[0])}
                    onFocus={() => setFocused(keys[0])}
                    className={cn(
                      cardBase,
                      'border-gray-200 bg-white hover:border-primary-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900',
                      dimmed(keys) && 'opacity-30',
                    )}
                  >
                    <span className="flex items-start gap-2">
                      <span className={cn('inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md', visual.wash, visual.ink)}>
                        <Glyph className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                          {attention.name}
                        </span>
                        <span className="block truncate text-2xs text-gray-500 dark:text-gray-400">
                          {attention.businessProgramIds.length > 0
                            ? attention.businessProgramIds.map(labelForKey).join(' · ')
                            : 'Sin iniciativa'}
                        </span>
                      </span>
                    </span>
                    {/* An empty rollup ratio is 1 by definition, so an attention
                        with no deliverables would read "100 %" — nothing done
                        looking exactly like everything done. */}
                    {attention.rollup.tasksTotal === 0 ? (
                      <span className="mt-1.5 block text-2xs text-gray-400 dark:text-gray-500">
                        Sin trabajo planificado
                      </span>
                    ) : (
                      <span className="mt-1.5 flex items-center gap-1.5">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
                          <span
                            className={cn('block h-full rounded-full', visual.surface)}
                            style={{ width: `${Math.round(attention.rollup.completionRatio * 100)}%` }}
                          />
                        </span>
                        <span className="text-2xs tabular-nums text-gray-500 dark:text-gray-400">
                          {formatPercent(attention.rollup.completionRatio)}
                        </span>
                      </span>
                    )}
                  </button>
                );
              })}
              {unlinked.length > 0 && (
                <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-2xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
                  {unlinked.length} proyecto(s) sin iniciativa de negocio. Enlázalos
                  para que aparezcan en la cadena.
                </p>
              )}
            </div>
          </section>

          {/* Level 3 — the governed unit of work */}
          <section aria-label={EA_LEVELS.deliverable.plural}>
            <h3 className={columnHeader}>
              <Briefcase className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
              {EA_LEVELS.deliverable.shortPlural}
              <span className="ml-auto tabular-nums">{deliverables.length}</span>
            </h3>
            <div className="space-y-2">
              {deliverables.map(({ engagement, attention, keys }) => {
                const progress = summarizeEngagementProgress(engagement.tasks);
                const visual = OFFICE_HEALTH_VISUALS[healthBucketOf(engagement.status)];
                return (
                  <button
                    key={engagement.id}
                    type="button"
                    onClick={() => onOpenDeliverable(engagement.id)}
                    onMouseEnter={() => setFocused(keys[0])}
                    onFocus={() => setFocused(keys[0])}
                    className={cn(
                      cardBase,
                      'border-gray-200 bg-white hover:border-primary-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900',
                      dimmed(keys) && 'opacity-30',
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                          {engagement.title}
                        </span>
                        <span className="block truncate text-2xs text-gray-500 dark:text-gray-400">
                          {attention.name}
                        </span>
                      </span>
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', visual.surface)} aria-hidden />
                    </span>
                    <span className="mt-1 flex items-center justify-between gap-2">
                      <Badge tone={ENGAGEMENT_STATUS_TONES[engagement.status]} size="xs">
                        {ENGAGEMENT_STATUS_LABELS[engagement.status]}
                      </Badge>
                      <span className="text-2xs tabular-nums text-gray-500 dark:text-gray-400">
                        {progress.completed}/{progress.total}
                      </span>
                    </span>
                  </button>
                );
              })}
              {deliverables.length === 0 && (
                <p className="rounded-lg bg-white px-2.5 py-2 text-2xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                  Sin entregables abiertos.
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PortfolioCanvas;

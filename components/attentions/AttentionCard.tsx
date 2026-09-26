/**
 * One architecture attention, as a row in the portfolio list.
 *
 * Reads in the same order as the initiative card one level up — what it is,
 * how healthy it is, what it answers, how much has shipped — with one addition
 * that belongs only to this level: the initiative it serves is shown as the
 * key it actually is, and its absence is stated loudly rather than left blank.
 * An attention with no initiative is architecture work with no declared
 * business reason, which is a finding, not an empty field.
 *
 * The card is a container of controls, not one big button: linking an
 * initiative and opening a new deliverable are actions in their own right, and
 * nesting them inside a clickable card would make them unreachable by keyboard.
 */

import React from 'react';
import { Badge, Button, cn } from '../ui';
import { ArrowRight, CalendarClock, FileStack, Landmark, Layers, Link2, Plus } from 'lucide-react';
import { HEALTH_ICONS } from '../architectureOffice/officeUiIcons';
import { OFFICE_HEALTH_VISUALS, formatPercent } from '../architectureOffice/officeChartTokens';
import type { ArchitectureProjectNode } from '../../services/architectureOffice/domain/officePortfolio';

/** The initiative behind an attention, reduced to what the card shows. */
export interface AttentionInitiativeRef {
  id: string;
  code: string;
  title: string;
}

export interface AttentionCardProps {
  node: ArchitectureProjectNode;
  /** Initiatives this attention answers, resolved by key. May be empty. */
  initiatives: AttentionInitiativeRef[];
  onOpen: () => void;
  onNewDeliverable: () => void;
  onLinkInitiative: () => void;
  onOpenInitiative?: (initiativeId: string) => void;
  className?: string;
}

/**
 * The timestamp the portfolio carries also moves when the project record itself
 * is edited, so an attention with no deliverables would report "última
 * actividad" for work the Office never did. Say what is true instead.
 */
const formatActivity = (iso: string | undefined, engagements: number): string => {
  if (engagements === 0) return 'Sin entregables todavía';
  if (!iso) return 'Sin actividad de oficina';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return 'Sin actividad de oficina';
  return `Última actividad ${parsed.toLocaleDateString('es', { day: '2-digit', month: 'short' })}`;
};

export const AttentionCard: React.FC<AttentionCardProps> = ({
  node,
  initiatives,
  onOpen,
  onNewDeliverable,
  onLinkInitiative,
  onOpenInitiative,
  className,
}) => {
  const visual = OFFICE_HEALTH_VISUALS[node.health];
  const HealthGlyph = HEALTH_ICONS[node.health];
  const progress = node.rollup.tasksTotal === 0 ? null : node.rollup.completionRatio;

  return (
    <article
      className={cn(
        'flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-all',
        'hover:border-primary-300 hover:shadow-md dark:border-gray-800 dark:bg-gray-900 dark:hover:border-primary-700',
        className,
      )}
    >
      <span className={cn('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', visual.wash, visual.ink)}>
        <HealthGlyph className="h-5 w-5" aria-hidden strokeWidth={2} />
      </span>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <button
              type="button"
              onClick={onOpen}
              className="block max-w-full truncate rounded text-left text-sm font-semibold text-gray-900 hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-100 dark:hover:text-primary-400"
            >
              {node.name}
            </button>
            <span className={cn('mt-0.5 block text-2xs font-medium', visual.ink)}>{visual.label}</span>
          </div>
          <Badge tone={visual.badgeTone} size="xs">
            {node.rollup.engagements} entregable(s)
          </Badge>
        </div>

        {/* The relation, by key. Its absence is the loudest thing on the card. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Landmark className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden />
          {initiatives.length === 0 ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2 py-0.5 text-2xs font-medium text-[#dc2626] dark:bg-red-950/30 dark:text-[#ef4444]">
              Sin iniciativa de negocio
            </span>
          ) : (
            initiatives.map((initiative) => (
              <button
                key={initiative.id}
                type="button"
                onClick={() => onOpenInitiative?.(initiative.id)}
                disabled={!onOpenInitiative}
                title={initiative.title}
                className={cn(
                  'inline-flex max-w-[16rem] items-center gap-1 rounded-lg bg-primary-50 px-2 py-0.5 text-2xs font-medium text-primary-700 dark:bg-primary-950/40 dark:text-primary-300',
                  onOpenInitiative && 'hover:bg-primary-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-primary-900/50',
                )}
              >
                <span className="whitespace-nowrap font-mono font-semibold">{initiative.code}</span>
                <span className="truncate">{initiative.title}</span>
              </button>
            ))
          )}
        </div>

        {node.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            {node.description}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1">
            <Layers className="h-3 w-3" aria-hidden />
            {progress === null ? 'Sin trabajo planificado' : `Tareas ${formatPercent(progress)}`}
          </span>
          <span className="inline-flex items-center gap-1">
            <FileStack className="h-3 w-3" aria-hidden />
            {node.artifactCount} artefacto(s)
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3 w-3" aria-hidden />
            {formatActivity(node.lastActivityAt, node.rollup.engagements)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="sm" onClick={onOpen} rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
            Abrir
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={onNewDeliverable}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
          >
            Nuevo entregable
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onLinkInitiative}
            leftIcon={<Link2 className="h-3.5 w-3.5" />}
          >
            {initiatives.length === 0 ? 'Vincular iniciativa' : 'Cambiar iniciativa'}
          </Button>
        </div>
      </div>
    </article>
  );
};

export default AttentionCard;

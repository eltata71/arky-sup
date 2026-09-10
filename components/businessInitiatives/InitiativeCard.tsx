/**
 * One business initiative, as a row in the portfolio list.
 *
 * Answers the four questions a portfolio review asks in the same order every
 * time: what is it, how healthy is it, when does it land, and how much
 * architecture is already serving it.
 */

import React from 'react';
import { Badge, cn } from '../ui';
import { ArrowRight, Boxes, CalendarClock, MoreHorizontal, Target } from 'lucide-react';
import { POINTER_ONLY_OVERLAY } from '../../lib/a11y';
import {
  describeRemaining,
  formatDate,
  INITIATIVE_HEALTH_ICONS,
  INITIATIVE_HEALTH_LABELS,
  INITIATIVE_STATUS_LABELS,
  INITIATIVE_STATUS_TONES,
  initiativeHealthVisual,
  PRIORITY_LABELS,
  PRIORITY_TONES,
} from './initiativeUiLabels';
import { formatPercent } from '../architectureOffice/officeChartTokens';
import { initiativeHealth } from '../../services/businessInitiatives/initiativeMetrics';
import { assessCompleteness } from '../../services/businessInitiatives/initiativeMetrics';
import {
  daysRemaining,
  isClosedInitiative,
  kpiProgress,
  summarizeMilestones,
  type BusinessInitiative,
} from '../../services/businessInitiatives/BusinessInitiativeTypes';

/** One entry in the card's overflow menu. */
export interface InitiativeCardAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  /** Renders in the danger tone and sits below a separator. */
  destructive?: boolean;
}

export interface InitiativeCardProps {
  initiative: BusinessInitiative;
  /** Architecture projects linked to this initiative by key. */
  attentionCount: number;
  onOpen: () => void;
  /**
   * Everything that is not "open". Rendered in an overflow menu rather than as
   * a row of buttons: these are occasional actions, and a card that shows five
   * of them competes with its own content for attention.
   */
  actions?: InitiativeCardAction[];
  className?: string;
}

export const InitiativeCard: React.FC<InitiativeCardProps> = ({
  initiative,
  attentionCount,
  onOpen,
  actions = [],
  className,
}) => {
  const [menuOpen, setMenuOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const health = initiativeHealth(initiative);
  const visual = initiativeHealthVisual(health);
  const HealthGlyph = INITIATIVE_HEALTH_ICONS[health];
  // Only an open initiative can be late. A delivered one that passed its date
  // on the way there is finished, not overdue — saying otherwise contradicts
  // the health badge sitting right beside it.
  const remaining = isClosedInitiative(initiative.status)
    ? null
    : describeRemaining(daysRemaining(initiative.targetEndDate));
  const milestones = summarizeMilestones(initiative.milestones);
  const completeness = assessCompleteness(initiative);

  const measurable = initiative.kpis
    .map(kpiProgress)
    .filter((value): value is number => value !== null);
  const attainment = measurable.length === 0
    ? null
    : measurable.reduce((sum, value) => sum + value, 0) / measurable.length;

  return (
    <div
      className={cn(
        'relative flex w-full items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-left shadow-sm transition-all',
        'hover:border-primary-300 hover:shadow-md',
        'dark:border-gray-800 dark:bg-gray-900 dark:hover:border-primary-700',
        className,
      )}
    >
      {/*
        * A pointer-only target covering the card. It is deliberately outside
        * the accessibility tree and the tab order: left focusable it announced
        * a control named after the card, immediately followed by the card's own
        * text — the same content twice. Keyboard and screen-reader users open
        * the initiative from its title below, which is a real button.
        * See rule 3 in `lib/a11y.ts`.
        */}
      <span
        {...POINTER_ONLY_OVERLAY}
        onClick={onOpen}
        className="absolute inset-0 z-0 cursor-pointer rounded-2xl"
      />
      <span className={cn('pointer-events-none relative z-10 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', visual.wash, visual.ink)}>
        <HealthGlyph className="h-5 w-5" aria-hidden strokeWidth={2} />
      </span>

      <span className="pointer-events-none relative z-10 min-w-0 flex-1 space-y-2">
        <span className="flex flex-wrap items-start justify-between gap-2">
          <span className="min-w-0">
            <button
              type="button"
              onClick={onOpen}
              className="pointer-events-auto block max-w-full truncate rounded text-left text-sm font-semibold text-gray-900 hover:text-primary-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-100 dark:hover:text-primary-400"
            >
              {initiative.title}
            </button>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-2xs text-gray-500 dark:text-gray-400">
              {initiative.code && <span className="font-mono font-semibold">{initiative.code}</span>}
              <span className={cn('font-medium', visual.ink)}>{INITIATIVE_HEALTH_LABELS[health]}</span>
            </span>
          </span>
          <span className="flex shrink-0 flex-wrap items-center gap-1.5">
            <Badge tone={PRIORITY_TONES[initiative.priority]} size="xs">
              {PRIORITY_LABELS[initiative.priority]}
            </Badge>
            <Badge tone={INITIATIVE_STATUS_TONES[initiative.status]} size="xs">
              {INITIATIVE_STATUS_LABELS[initiative.status]}
            </Badge>
          </span>
        </span>

        {initiative.driver && (
          <span className="line-clamp-2 block text-xs leading-relaxed text-gray-600 dark:text-gray-300">
            {initiative.driver}
          </span>
        )}

        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-gray-500 dark:text-gray-400">
          <span className="inline-flex items-center gap-1">
            <Boxes className="h-3 w-3" aria-hidden />
            {attentionCount} proyecto(s)
          </span>
          <span className="inline-flex items-center gap-1">
            <Target className="h-3 w-3" aria-hidden />
            {attainment === null
              ? `${initiative.kpis.length} KPI sin medir`
              : `KPI ${formatPercent(attainment)}`}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3 w-3" aria-hidden />
            {formatDate(initiative.targetEndDate)}
            {milestones.total > 0 && ` · ${milestones.met}/${milestones.total} hitos`}
          </span>
          {remaining && (
            <span className={cn(
              'font-medium',
              remaining.overdue ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400',
            )}>
              {remaining.text}
            </span>
          )}
        </span>

        {/* Completeness is the gap a reviewer can act on: it counts whether the
            questions were answered, not whether the answers are good. */}
        {completeness.ratio < 1 && (
          <span className="flex items-center gap-2">
            <span className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <span
                className="block h-full rounded-full bg-gray-400 transition-all dark:bg-gray-500"
                style={{ width: `${Math.round(completeness.ratio * 100)}%` }}
              />
            </span>
            <span className="truncate text-2xs text-gray-400 dark:text-gray-500">
              Ficha {formatPercent(completeness.ratio)} · falta {completeness.missing[0]}
              {completeness.missing.length > 1 && ` y ${completeness.missing.length - 1} más`}
            </span>
          </span>
        )}
      </span>

      <div className="relative z-10 mt-0.5 flex shrink-0 items-center gap-1">
        {actions.length > 0 && (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label={`Más opciones de ${initiative.title}`}
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((open) => !open)}
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors',
                'hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                'dark:hover:bg-gray-800 dark:hover:text-gray-200',
                menuOpen && 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200',
              )}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden />
            </button>

            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-9 z-30 w-60 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-pop dark:border-gray-800 dark:bg-gray-900"
              >
                {actions.map((action, index) => (
                  <React.Fragment key={action.id}>
                    {action.destructive && index > 0 && (
                      <div className="my-1 h-px bg-gray-100 dark:bg-gray-800" aria-hidden />
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { setMenuOpen(false); action.onSelect(); }}
                      className={cn(
                        'flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium transition-colors',
                        action.destructive
                          ? 'text-[#dc2626] hover:bg-red-50 dark:text-[#ef4444] dark:hover:bg-red-950/30'
                          : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-800',
                      )}
                    >
                      <span className={action.destructive ? '' : 'text-gray-400 dark:text-gray-500'}>{action.icon}</span>
                      {action.label}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}
          </div>
        )}
        <ArrowRight className="pointer-events-none h-4 w-4 text-gray-300 dark:text-gray-700" aria-hidden />
      </div>
    </div>
  );
};

export default InitiativeCard;

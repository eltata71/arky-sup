/**
 * What is waiting on a person.
 *
 * This is the only part of the dashboard that asks for an action, so it gets to
 * sit at the top and look urgent. Every row states *why* it is stuck in a
 * sentence, because "Bloqueado" alone sends the reader hunting.
 */

import React from 'react';
import { Badge, Button, Card, CardTitle, cn } from '../../ui';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { HEALTH_ICONS } from '../officeUiIcons';
import { OFFICE_HEALTH_VISUALS } from '../officeChartTokens';
import { ENGAGEMENT_STATUS_LABELS, ENGAGEMENT_STATUS_TONES } from '../officeUiLabels';
import type { OfficeDecisionItem } from '../../../services/architectureOffice/domain/officePortfolio';

export interface DecisionQueueProps {
  items: OfficeDecisionItem[];
  /** True when the signed-in user may issue an ARB decision. */
  canApprove: boolean;
  onOpen: (engagementId: string) => void;
  className?: string;
  id?: string;
}

export const DecisionQueue: React.FC<DecisionQueueProps> = ({
  items,
  canApprove,
  onOpen,
  className,
  id,
}) => {
  if (items.length === 0) {
    return (
      <Card id={id} className={cn('flex items-center gap-3', className)}>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <HEALTH_ICONS.delivered className="h-5 w-5" aria-hidden strokeWidth={2} />
        </span>
        <div>
          <CardTitle>Nada espera por ti</CardTitle>
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            Ningún entregable está bloqueado ni pendiente de una decisión.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card id={id} tone="gradient" className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/80 text-amber-700 dark:bg-gray-900/70 dark:text-amber-300">
            <ShieldAlert className="h-4.5 w-4.5" aria-hidden strokeWidth={2} />
          </span>
          <div>
            <CardTitle>Requieren tu decisión</CardTitle>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {items.length} entregable(s) no pueden avanzar sin una persona.
            </p>
          </div>
        </div>
      </div>

      <ul className="space-y-2">
        {items.map((item) => {
          const visual = OFFICE_HEALTH_VISUALS[item.bucket];
          const Glyph = HEALTH_ICONS[item.bucket];
          return (
            <li
              key={item.engagement.id}
              className="flex flex-wrap items-center gap-3 rounded-xl bg-white/80 px-3 py-2.5 dark:bg-gray-900/70"
            >
              <span className={cn('inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', visual.wash, visual.ink)}>
                <Glyph className="h-4 w-4" aria-hidden strokeWidth={2} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {item.engagement.title}
                </p>
                <p className="truncate text-2xs text-gray-500 dark:text-gray-400">
                  {item.programName} › {item.projectName}
                </p>
                <p className={cn('mt-0.5 text-xs font-medium', visual.ink)}>{item.reason}</p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Badge tone={ENGAGEMENT_STATUS_TONES[item.engagement.status]} size="xs">
                  {ENGAGEMENT_STATUS_LABELS[item.engagement.status]}
                </Badge>
                {item.requiresAdmin && !canApprove && (
                  <Badge tone="gray" size="xs" outline>Requiere admin</Badge>
                )}
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => onOpen(item.engagement.id)}
                  aria-label={`Abrir ${item.engagement.title}`}
                >
                  Abrir
                  <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
};

export default DecisionQueue;

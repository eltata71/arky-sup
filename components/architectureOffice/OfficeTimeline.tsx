/**
 * Chronological record of what the office did on an engagement.
 *
 * Two sources are merged here on purpose:
 *  - the engagement's own `auditTrail` (who started what, who approved, which
 *    gates ran), and
 *  - `AgentActionRecord`s from `agent_actions`, which until now were
 *    **write-only**: `listAgentActions` existed in `AppContext` and
 *    `firestoreService` but no component ever called it, so the audit log the
 *    executor was carefully writing had no reader.
 */

import React, { useEffect, useState } from 'react';
import { Badge, cn } from '../ui';
import { useAppContext } from '../../context/AppContext';
import type { AgentActionRecord } from '../../services/agent/agentTypes';
import type { OfficeAuditEntry } from '../../services/architectureOffice/OfficeTypes';

interface OfficeTimelineProps {
  projectId: string;
  entries: OfficeAuditEntry[];
  /** Cap on agent action records pulled in. */
  agentActionLimit?: number;
}

interface TimelineItem {
  id: string;
  at: string;
  actor: string;
  title: string;
  detail?: string;
  tone: 'gray' | 'success' | 'warning' | 'danger' | 'primary';
}

const AUDIT_TONES: Record<string, TimelineItem['tone']> = {
  'task-failed': 'danger',
  'engagement-blocked': 'danger',
  'engagement-cancelled': 'danger',
  'budget-exhausted': 'danger',
  'task-changes-requested': 'warning',
  'task-completed': 'success',
  'charter-approved': 'success',
  'engagement-delivered': 'success',
  'arb-decided': 'primary',
  'run-started': 'primary',
  'submitted-to-arb': 'primary',
};

const formatTime = (value: string): string => {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
};

export const OfficeTimeline: React.FC<OfficeTimelineProps> = ({
  projectId,
  entries,
  agentActionLimit = 30,
}) => {
  const { listAgentActions } = useAppContext();
  const [agentActions, setAgentActions] = useState<AgentActionRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    void listAgentActions(projectId, { limit: agentActionLimit })
      .then((records) => { if (!cancelled) setAgentActions(records); })
      .catch(() => { if (!cancelled) setAgentActions([]); });
    return () => { cancelled = true; };
  }, [projectId, agentActionLimit, listAgentActions]);

  const items: TimelineItem[] = [
    ...entries.map((entry): TimelineItem => ({
      id: entry.id,
      at: entry.timestamp,
      actor: entry.actor.name,
      title: entry.details,
      detail: entry.before && entry.after ? `${entry.before} → ${entry.after}` : undefined,
      tone: AUDIT_TONES[entry.action] ?? 'gray',
    })),
    ...agentActions.map((record): TimelineItem => ({
      id: record.traceId,
      at: record.completedAt || record.createdAt,
      actor: record.actorName,
      title: `${record.actionType} — ${record.status}`,
      detail: record.appliedChanges[0] ?? record.validationSummary ?? undefined,
      tone: record.status === 'success' ? 'success' : record.status === 'failed' ? 'danger' : 'gray',
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  if (items.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">Todavía no hay actividad registrada.</p>;
  }

  return (
    <ol className="space-y-2" aria-label="Actividad de la Oficina">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'mt-1.5 h-2 w-2 shrink-0 rounded-full',
              item.tone === 'success' && 'bg-green-500',
              item.tone === 'warning' && 'bg-amber-500',
              item.tone === 'danger' && 'bg-red-500',
              item.tone === 'primary' && 'bg-primary-500',
              item.tone === 'gray' && 'bg-gray-300 dark:bg-gray-600',
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-800 dark:text-gray-200 leading-snug">{item.title}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-xs text-gray-500 dark:text-gray-400">{formatTime(item.at)}</span>
              <Badge tone="gray" size="xs" outline>{item.actor}</Badge>
              {item.detail && (
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.detail}</span>
              )}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
};

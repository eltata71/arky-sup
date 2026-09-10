/**
 * The engagement board: every task of the DAG, grouped by the stage it is in,
 * with the persona accountable for it and — where a reviewer has spoken — the
 * findings that sent it back.
 *
 * This is the surface that makes the office legible: who is doing what right
 * now, what is waiting on what, and where work is stuck.
 *
 * Two things carry the reading. Every column and every status wears a glyph as
 * well as a colour, so a scan resolves without reading each badge; and each
 * card is banded down its left edge in its status colour, which turns a dense
 * column into a shape you can take in at a glance.
 */

import React from 'react';
import { Badge, Card, cn } from '../ui';
import { ArrowUpRight } from 'lucide-react';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/officeAgentPersonas';
import type { OfficeTask, OfficeTaskStatus } from '../../services/architectureOffice/OfficeTypes';
import { PersonaChip } from './PersonaAvatar';
import { SEVERITY_ICONS, TASK_KIND_ICONS, TASK_STATUS_ICONS } from './officeUiIcons';
import {
  describeAging,
  REVIEW_VERDICT_LABELS,
  REVIEW_VERDICT_TONES,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  TASK_BOARD_COLUMNS,
  TASK_KIND_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUS_TONES,
} from './officeUiLabels';

interface EngagementTaskBoardProps {
  tasks: OfficeTask[];
  /** Called when the user opens the artifact a task produced. */
  onOpenArtifact?: (artifactId: string) => void;
}

/**
 * Left-edge band per status. Written out in full — Tailwind only compiles class
 * strings it can see literally in the source.
 */
const STATUS_ACCENT: Readonly<Record<OfficeTaskStatus, string>> = Object.freeze({
  pending: 'border-l-gray-300 dark:border-l-gray-700',
  ready: 'border-l-blue-400 dark:border-l-blue-500',
  'in-progress': 'border-l-[#4f46e5] dark:border-l-[#6366f1]',
  'awaiting-review': 'border-l-ai-400 dark:border-l-ai-500',
  'changes-requested': 'border-l-[#d97706]',
  completed: 'border-l-[#059669]',
  failed: 'border-l-[#dc2626] dark:border-l-[#ef4444]',
  skipped: 'border-l-gray-300 dark:border-l-gray-700',
  cancelled: 'border-l-gray-300 dark:border-l-gray-700',
});

const TaskCard: React.FC<{ task: OfficeTask; tasks: OfficeTask[]; onOpenArtifact?: (id: string) => void }> = ({
  task,
  tasks,
  onOpenArtifact,
}) => {
  const reviewer = task.reviewerId ? OFFICE_AGENT_PERSONAS[task.reviewerId] : undefined;
  const aging = describeAging(task.dueAt);
  const StatusGlyph = TASK_STATUS_ICONS[task.status];
  const KindGlyph = TASK_KIND_ICONS[task.kind];
  const blockers = task.dependsOn
    .map((id) => tasks.find((candidate) => candidate.id === id))
    .filter((dependency): dependency is OfficeTask => Boolean(dependency))
    .filter((dependency) => dependency.status !== 'completed' && dependency.status !== 'skipped');

  return (
    <Card compact className={cn('space-y-2.5 border-l-4', STATUS_ACCENT[task.status])}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug text-gray-900 dark:text-gray-100">{task.title}</p>
        <Badge tone={TASK_STATUS_TONES[task.status]} size="xs">
          <StatusGlyph className="mr-1 h-3 w-3" aria-hidden />
          {TASK_STATUS_LABELS[task.status]}
        </Badge>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="gray" size="xs" outline>
          <KindGlyph className="mr-1 h-3 w-3" aria-hidden />
          {TASK_KIND_LABELS[task.kind]}
        </Badge>
        <PersonaChip personaId={task.assigneeId} />
        {reviewer && task.kind === 'produce-artifact' && (
          <PersonaChip personaId={reviewer.id} prefix="Revisa" />
        )}
        {task.attempts > 1 && (
          <Badge tone="warning" size="xs" outline>Intento {task.attempts}/{task.maxAttempts}</Badge>
        )}
      </div>

      {aging && (
        <p className={cn(
          'text-xs font-medium',
          aging.startsWith('Vencida') ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400',
        )}>
          {aging}
        </p>
      )}

      {blockers.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Espera a: {blockers.map((dependency) => dependency.title).join(', ')}
        </p>
      )}

      {task.error && (
        <p className="text-xs leading-snug text-red-600 dark:text-red-400">{task.error}</p>
      )}

      {task.review && (
        <div className="space-y-1.5 rounded-lg bg-gray-50 p-2 dark:bg-gray-800/60">
          <div className="flex items-center gap-1.5">
            <Badge tone={REVIEW_VERDICT_TONES[task.review.verdict]} size="xs">
              {REVIEW_VERDICT_LABELS[task.review.verdict]}
            </Badge>
            {task.review.deterministicScore !== undefined && (
              <Badge tone="gray" size="xs" outline>{task.review.deterministicScore}/100</Badge>
            )}
          </div>
          <p className="text-xs leading-snug text-gray-600 dark:text-gray-300">{task.review.summary}</p>
          {task.review.findings.length > 0 && (
            <ul className="space-y-1">
              {task.review.findings.slice(0, 4).map((finding, index) => {
                const SeverityGlyph = SEVERITY_ICONS[finding.severity];
                return (
                  <li key={`${finding.message}-${index}`} className="flex items-start gap-1.5 text-xs">
                    <Badge tone={SEVERITY_TONES[finding.severity]} size="xs">
                      <SeverityGlyph className="mr-0.5 h-3 w-3" aria-hidden />
                      {SEVERITY_LABELS[finding.severity]}
                    </Badge>
                    <span className="leading-snug text-gray-600 dark:text-gray-300">{finding.message}</span>
                  </li>
                );
              })}
              {task.review.findings.length > 4 && (
                <li className="text-xs text-gray-500 dark:text-gray-400">
                  y {task.review.findings.length - 4} hallazgo(s) más
                </li>
              )}
            </ul>
          )}
        </div>
      )}

      {task.producedArtifactId && onOpenArtifact && (
        <button
          type="button"
          onClick={() => onOpenArtifact(task.producedArtifactId!)}
          className="inline-flex items-center gap-1 rounded text-xs font-semibold text-primary-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-400"
        >
          Abrir artefacto
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </Card>
  );
};

export const EngagementTaskBoard: React.FC<EngagementTaskBoardProps> = ({ tasks, onOpenArtifact }) => {
  if (tasks.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Este entregable todavía no tiene tareas planificadas.
      </p>
    );
  }

  const columns = TASK_BOARD_COLUMNS
    .map((column) => ({
      ...column,
      items: tasks.filter((task) => column.statuses.includes(task.status)),
    }))
    .filter((column) => column.items.length > 0);

  return (
    <div
      className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      role="group"
      aria-label="Tareas del entregable"
    >
      {columns.map((column) => {
        // Every column takes its glyph from the first status it collects, so
        // the header shape matches the cards underneath it.
        const ColumnGlyph = TASK_STATUS_ICONS[column.statuses[0]];
        return (
          <section key={column.id} className="space-y-2" aria-label={column.label}>
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-900/60">
              <h3 className="inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
                <ColumnGlyph className="h-3.5 w-3.5" aria-hidden strokeWidth={2} />
                {column.label}
              </h3>
              <span className="rounded-md bg-white px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {column.items.length}
              </span>
            </div>
            <div className="space-y-2">
              {column.items.map((task) => (
                <TaskCard key={task.id} task={task} tasks={tasks} onOpenArtifact={onOpenArtifact} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
};

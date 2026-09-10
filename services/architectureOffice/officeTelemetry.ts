/**
 * Engagement telemetry.
 *
 * The office is only tunable if it is measurable: which persona's output gets
 * sent back most often, how much of the budget an engagement really costs, how
 * long each stage takes. These are the numbers that tell you *which persona
 * prompt to fix*, rather than guessing.
 *
 * Pure derivation plus a thin emit on top of `observabilityService`. No I/O of
 * its own, so the summary can be rendered or asserted without a running app.
 */

import { observabilityService } from '../observability';
import { OFFICE_AGENT_PERSONAS, type OfficeAgentId } from './officeAgentPersonas';
import {
  summarizeEngagementProgress,
  type OfficeEngagement,
  type OfficeTask,
} from './OfficeTypes';

export interface OfficePersonaMetrics {
  personaId: OfficeAgentId;
  alias: string;
  produced: number;
  failed: number;
  /** Times this persona's output was sent back by a reviewer. */
  changesRequested: number;
  /** Times this persona reviewed someone else's work. */
  reviewed: number;
  /** Mean deterministic compiler score across the reviews of its output. */
  averageScore: number | null;
  /** Mean wall-clock minutes per completed task. */
  averageMinutes: number | null;
}

export interface OfficeEngagementMetrics {
  engagementId: string;
  status: OfficeEngagement['status'];
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  /** Production re-runs caused by a reviewer asking for changes. */
  reworkCount: number;
  /** 0..1 — deliverables sent back at least once, over deliverables produced. */
  reworkRate: number;
  aiCallsConsumed: number;
  aiCallsBudget: number;
  budgetUtilisation: number;
  /** Wall-clock minutes from the first task start to the last completion. */
  elapsedMinutes: number | null;
  personas: OfficePersonaMetrics[];
}

const minutesBetween = (from: string | undefined, to: string | undefined): number | null => {
  if (!from || !to) return null;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round(((end - start) / 60_000) * 10) / 10;
};

const mean = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const total = values.reduce((sum, value) => sum + value, 0);
  return Math.round((total / values.length) * 10) / 10;
};

const isProduction = (task: OfficeTask): boolean => task.kind === 'produce-artifact';

export const summarizeEngagementMetrics = (engagement: OfficeEngagement): OfficeEngagementMetrics => {
  const progress = summarizeEngagementProgress(engagement.tasks);
  const productions = engagement.tasks.filter(isProduction);
  const reviews = engagement.tasks.filter((task) => task.kind === 'review-artifact');

  // Every attempt past the first is a re-run the reviewer asked for.
  const reworkCount = productions.reduce((total, task) => total + Math.max(0, task.attempts - 1), 0);
  const reworkedDeliverables = productions.filter((task) => task.attempts > 1).length;

  const personaIds = new Set<OfficeAgentId>(engagement.tasks.map((task) => task.assigneeId));
  const personas: OfficePersonaMetrics[] = [...personaIds].map((personaId) => {
    const owned = productions.filter((task) => task.assigneeId === personaId);
    const reviewsOfOwned = reviews.filter((review) => (
      owned.some((task) => task.id === review.reviewsTaskId)
    ));
    const scores = reviewsOfOwned
      .map((review) => review.review?.deterministicScore)
      .filter((score): score is number => typeof score === 'number');
    const durations = owned
      .map((task) => minutesBetween(task.startedAt, task.completedAt))
      .filter((value): value is number => value !== null);

    return {
      personaId,
      alias: OFFICE_AGENT_PERSONAS[personaId].alias,
      produced: owned.filter((task) => task.status === 'completed').length,
      failed: owned.filter((task) => task.status === 'failed').length,
      changesRequested: reviewsOfOwned.filter((review) => review.review?.verdict === 'changes-requested').length,
      reviewed: reviews.filter((review) => review.assigneeId === personaId).length,
      averageScore: mean(scores),
      averageMinutes: mean(durations),
    };
  }).sort((a, b) => b.produced - a.produced || a.alias.localeCompare(b.alias));

  const startedAt = engagement.tasks
    .map((task) => task.startedAt)
    .filter((value): value is string => Boolean(value))
    .sort()[0];
  const completedAt = engagement.tasks
    .map((task) => task.completedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  return {
    engagementId: engagement.id,
    status: engagement.status,
    totalTasks: progress.total,
    completedTasks: progress.completed,
    failedTasks: progress.failed,
    reworkCount,
    reworkRate: productions.length === 0 ? 0 : reworkedDeliverables / productions.length,
    aiCallsConsumed: engagement.budget.consumedAiCalls,
    aiCallsBudget: engagement.budget.maxAiCalls,
    budgetUtilisation: engagement.budget.maxAiCalls === 0
      ? 0
      : engagement.budget.consumedAiCalls / engagement.budget.maxAiCalls,
    elapsedMinutes: minutesBetween(startedAt, completedAt),
    personas,
  };
};

/**
 * Emits the summary into the global observability stream. Never throws — a
 * telemetry failure must not affect an engagement.
 */
export const trackEngagementCompleted = (engagement: OfficeEngagement): void => {
  try {
    const metrics = summarizeEngagementMetrics(engagement);
    observabilityService.trackEvent({
      source: 'operation',
      severity: metrics.failedTasks > 0 ? 'warning' : 'success',
      status: metrics.failedTasks > 0 ? 'observed' : 'succeeded',
      title: 'Entregable de la Oficina finalizado',
      message: `${metrics.completedTasks}/${metrics.totalTasks} tareas completadas · ${metrics.aiCallsConsumed}/${metrics.aiCallsBudget} llamadas de IA.`,
      operationId: engagement.id,
      operationName: 'officeEngagementRun',
      recoverable: true,
      userVisible: false,
      metadata: {
        engagementId: metrics.engagementId,
        engagementStatus: metrics.status,
        totalTasks: metrics.totalTasks,
        completedTasks: metrics.completedTasks,
        failedTasks: metrics.failedTasks,
        reworkCount: metrics.reworkCount,
        reworkRate: Math.round(metrics.reworkRate * 100) / 100,
        aiCallsConsumed: metrics.aiCallsConsumed,
        budgetUtilisation: Math.round(metrics.budgetUtilisation * 100) / 100,
        elapsedMinutes: metrics.elapsedMinutes ?? undefined,
        gateStatus: engagement.gateAssessment?.overallStatus,
        charterProvenance: engagement.charter.provenance,
        personas: metrics.personas
          .map((persona) => `${persona.personaId}:${persona.produced}/${persona.changesRequested}`)
          .join(','),
      },
    });
  } catch {
    // Telemetry is never load-bearing.
  }
};

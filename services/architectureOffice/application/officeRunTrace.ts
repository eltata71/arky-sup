/**
 * Reconstructing one execution attempt from what the engagement recorded.
 *
 * The correlation ids are only worth storing if something reads them back, and
 * this is that something. Before it, an engagement carried two halves of a
 * story and no thread between them: the audit trail said a task started and
 * finished, the agent action log held the prompt, the phases, the versions and
 * the rollback of the generation that did the work, and nothing joined the two.
 * `executeAgentAction` had been returning its trace id since the agent shipped
 * and the Office discarded it.
 *
 * Two properties this module is careful about:
 *
 * - **A run is an attempt, not the engagement.** An engagement resumes rather
 *   than restarts, so "what happened" is ambiguous until you say which attempt
 *   you mean. Entries and tasks without a `runId` are the ones written before
 *   this existed; they are reported under `unattributed` rather than folded
 *   into the newest run, because guessing would date old work to today.
 * - **It derives, never stores.** A stored summary is a second copy of the
 *   trail that goes stale the moment a task is retried.
 */

import type { OfficeAuditEntry, OfficeEngagement, OfficeTask } from '../domain/OfficeTypes';

export interface OfficeRunSummary {
  runId: string;
  /** Tasks this attempt scheduled, in the engagement's order. */
  tasks: OfficeTask[];
  /** Audit entries this attempt wrote, oldest first. */
  auditTrail: OfficeAuditEntry[];
  /**
   * Every correlation id the attempt produced, de-duplicated, in the order the
   * tasks recorded them. The `agent-` ones join to
   * `projects/{id}/agent_actions/{traceId}`; the `office-` ones identify an
   * invocation through the legacy chat façade and join to nothing.
   */
  traceIds: string[];
  startedAt?: string;
  finishedAt?: string;
}

/** Run ids the engagement mentions, oldest first by the trail that names them. */
export const runIdsOf = (engagement: OfficeEngagement): string[] => {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (runId?: string): void => {
    if (!runId || seen.has(runId)) return;
    seen.add(runId);
    ordered.push(runId);
  };
  for (const entry of engagement.auditTrail) add(entry.runId);
  for (const task of engagement.tasks) add(task.runId);
  add(engagement.currentRunId);
  return ordered;
};

/** Everything one attempt did, derived from the engagement. */
export const describeRun = (
  engagement: OfficeEngagement,
  runId: string,
): OfficeRunSummary => {
  const tasks = engagement.tasks.filter((task) => task.runId === runId);
  const auditTrail = engagement.auditTrail.filter((entry) => entry.runId === runId);
  const traceIds: string[] = [];
  for (const task of tasks) {
    for (const traceId of task.traceIds ?? []) {
      if (!traceIds.includes(traceId)) traceIds.push(traceId);
    }
  }
  const timestamps = auditTrail.map((entry) => entry.timestamp).sort();
  return {
    runId,
    tasks,
    auditTrail,
    traceIds,
    startedAt: timestamps[0],
    finishedAt: timestamps[timestamps.length - 1],
  };
};

/** Every attempt, oldest first. */
export const describeRuns = (engagement: OfficeEngagement): OfficeRunSummary[] =>
  runIdsOf(engagement).map((runId) => describeRun(engagement, runId));

/**
 * What the engagement recorded before runs were correlated.
 *
 * Reported rather than absorbed into the first run: an engagement stored by an
 * older build has real history, and dating it to an attempt it never belonged
 * to would be worse than admitting it is unattributed.
 */
export const unattributedWork = (
  engagement: OfficeEngagement,
): { tasks: OfficeTask[]; auditTrail: OfficeAuditEntry[] } => ({
  tasks: engagement.tasks.filter((task) => !task.runId),
  auditTrail: engagement.auditTrail.filter((entry) => !entry.runId),
});

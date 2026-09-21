import type { OfficeEngagement, OfficeReviewFinding, OfficeTask } from './OfficeTypes';

export const runnerNowIso = (): string => new Date().toISOString();

export const withTaskTrace = (task: OfficeTask, traceId?: string): OfficeTask =>
  traceId ? { ...task, traceIds: [...(task.traceIds ?? []), traceId] } : task;

export const replaceRunnerTask = (engagement: OfficeEngagement, task: OfficeTask): OfficeEngagement => ({
  ...engagement,
  tasks: engagement.tasks.map((candidate) => (candidate.id === task.id ? task : candidate)),
  updatedAt: runnerNowIso(),
});

export const chargeRunnerBudget = (engagement: OfficeEngagement, calls: number): OfficeEngagement => ({
  ...engagement,
  budget: { ...engagement.budget, consumedAiCalls: engagement.budget.consumedAiCalls + Math.max(0, calls) },
});

export const isRunnerBudgetExhausted = (engagement: OfficeEngagement): boolean =>
  engagement.budget.consumedAiCalls >= engagement.budget.maxAiCalls;

export const runnerBlockingFindings = (findings: readonly OfficeReviewFinding[]): OfficeReviewFinding[] =>
  findings.filter((finding) => finding.severity === 'critical' || finding.severity === 'high');

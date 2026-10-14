import { summarizeAgentUsage, type AgentInvocationMeasurement, type AgentUsageSummary } from '../../../lib/ai/agentUsage';
import type { OfficeAgentId } from './officeAgentPersonas';
import type { OfficeEngagement, OfficeTask } from './OfficeTypes';

/** A call whose provider supplied no token accounting still counts as a call. */
export const unknownInvocation = (traceId?: string): AgentInvocationMeasurement => ({
  model: null,
  usage: null,
  latencyMs: 0,
  traceId: traceId ?? null,
  estimatedCostUsd: null,
});

export const summarizeEngagementUsage = (
  tasks: readonly OfficeTask[],
): NonNullable<OfficeEngagement['usage']> => {
  const all = tasks.flatMap((task) => task.measurements ?? []);
  const byAgent: Partial<Record<OfficeAgentId, AgentUsageSummary>> = {};
  for (const task of tasks) {
    const measurements = task.measurements ?? [];
    if (measurements.length === 0) continue;
    byAgent[task.assigneeId] = summarizeAgentUsage(tasks
      .filter((candidate) => candidate.assigneeId === task.assigneeId)
      .flatMap((candidate) => candidate.measurements ?? []));
  }
  return { total: summarizeAgentUsage(all), byAgent };
};

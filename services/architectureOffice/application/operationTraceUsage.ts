import { redactSecretShapes } from '../../../lib/secretShapes';
import type { AgentUsageSummary } from '../../../lib/ai/agentUsage';
import type { OfficeOrchestrationResult } from './officeOrchestrationTypes';

const summaryForTrace = (value: AgentUsageSummary): AgentUsageSummary => ({
  calls: value.calls, measuredCalls: value.measuredCalls, totalTokens: value.totalTokens,
  estimatedCostUsd: value.estimatedCostUsd, latencyMs: value.latencyMs,
});

/** Explicit allowlist: a runtime object can carry fields absent from its TypeScript type. */
export const usageForTrace = (value: OfficeOrchestrationResult['usage'] | undefined) => value ? {
  total: summaryForTrace(value.total),
  byAgent: Object.fromEntries(Object.entries(value.byAgent).flatMap(([id, summary]) =>
    summary ? [[redactSecretShapes(id), summaryForTrace(summary)]] : [])),
} : null;

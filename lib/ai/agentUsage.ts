/** Measurements for one model invocation. Missing token data is unknown, not zero. */
export interface AgentInvocationUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cachedPromptTokens?: number;
}

export interface AgentInvocationMeasurement {
  runId?: string;
  invocationId?: string;
  promptStamp?: string;
  status?: 'completed' | 'failed';
  startedAtMs?: number;
  /** Names returned by the model, not arguments nor claims of tool execution. */
  toolCalls?: string[];
  /** Provider requests attempted, including retries when known. */
  aiCalls?: number;
  model: string | null;
  usage: AgentInvocationUsage | null;
  latencyMs: number;
  traceId: string | null;
  /** Estimate at the published standard paid rate, never a provider invoice. */
  estimatedCostUsd: number | null;
}

export interface AgentInvocationResult extends AgentInvocationMeasurement {
  text: string;
}

/** Per-call observer, never a global collector shared by concurrent runs. */
export interface InvocationTelemetry {
  operationId?: string;
  onMeasurement?: (measurement: AgentInvocationMeasurement) => void;
}

/** USD per million tokens, Google Gemini Developer API standard paid tier.
 * Source: https://ai.google.dev/gemini-api/docs/pricing (checked 2026-10-15).
 * Higher Pro rates apply above 200k prompt tokens; cache and audio need their
 * own tariffs, so those requests deliberately return unknown cost. */
const PRICE_USD_PER_MILLION: Readonly<Record<string, { input: number; output: number }>> = {
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.50 },
};

export const estimateAgentCostUsd = (
  model: string | null,
  usage: AgentInvocationUsage | null,
): number | null => {
  if (!model || !usage || usage.promptTokens === undefined || usage.completionTokens === undefined) return null;
  if (usage.cachedPromptTokens && usage.cachedPromptTokens > 0) return null;
  if (model === 'gemini-2.5-pro' && usage.promptTokens > 200_000) return null;
  const price = PRICE_USD_PER_MILLION[model];
  if (!price) return null;
  return (usage.promptTokens * price.input + usage.completionTokens * price.output) / 1_000_000;
};

export interface AgentUsageSummary {
  calls: number;
  measuredCalls: number;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number;
}

export const summarizeAgentUsage = (measurements: readonly AgentInvocationMeasurement[]): AgentUsageSummary => ({
  calls: measurements.reduce((sum, item) => sum + (item.aiCalls ?? 1), 0),
  measuredCalls: measurements.filter((item) => item.usage?.totalTokens !== undefined).length,
  totalTokens: measurements.length > 0 && measurements.every((item) => item.usage?.totalTokens !== undefined)
    ? measurements.reduce((sum, item) => sum + (item.usage?.totalTokens ?? 0), 0)
    : null,
  estimatedCostUsd: measurements.length > 0 && measurements.every((item) => item.estimatedCostUsd !== null)
    ? measurements.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0)
    : null,
  latencyMs: measurements.reduce((sum, item) => sum + item.latencyMs, 0),
});

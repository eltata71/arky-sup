import { newTraceId } from '../../../lib/traceId';
import { estimateAgentCostUsd, type AgentInvocationMeasurement, type InvocationTelemetry } from '../../../lib/ai/agentUsage';
import type { AIGatewayOptions, AIGatewayResult } from './aiGateway';

/** Accounting only: no prompt, response text, function arguments or full AITrace. */
export const measurementFromResult = (result: AIGatewayResult, latencyMs: number): AgentInvocationMeasurement => ({
  model: result.model ?? null, usage: result.usage ?? null,
  latencyMs: result.latencyMs ?? latencyMs, traceId: result.traceId ?? null,
  aiCalls: result.aiCalls,
  estimatedCostUsd: estimateAgentCostUsd(result.model ?? null, result.usage ?? null),
  toolCalls: result.functionCalls?.flatMap((call) => call.name ? [call.name] : []),
});

export async function observeGeneration(
  options: InvocationTelemetry,
  invoke: (options: AIGatewayOptions) => Promise<AIGatewayResult>,
): Promise<AIGatewayResult> {
  const startedAtMs = Date.now();
  const requestId = newTraceId('generation');
  const report = (measurement: AgentInvocationMeasurement): void => {
    try { options.onMeasurement?.(measurement); } catch { /* An observer cannot change execution. */ }
  };
  try {
    const result = await invoke({ operationId: options.operationId, requestId });
    report({ ...measurementFromResult(result, Date.now() - startedAtMs),
      runId: options.operationId, invocationId: requestId, status: 'completed', startedAtMs });
    return result;
  } catch (error) {
    report({ model: null, usage: null, latencyMs: Date.now() - startedAtMs, traceId: requestId,
      estimatedCostUsd: null, runId: options.operationId, invocationId: requestId, status: 'failed', startedAtMs });
    throw error;
  }
}

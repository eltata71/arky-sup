import { redactSecretShapes } from '../../../lib/secretShapes';
import type { AgentInvocationMeasurement } from '../../../lib/ai/agentUsage';
import type { OfficeInvocationRecord } from './officeOrchestrationTypes';
import type { CoordinationEvent } from './officeCoordination';
import type { OperationTraceNode } from './officeOperationTrace';

/** Copy only safe accounting fields. Neither prompts nor provider payloads are measurements. */
export const traceMeasurement = (value: AgentInvocationMeasurement): AgentInvocationMeasurement => ({
  runId: value.runId ? redactSecretShapes(value.runId) : undefined,
  invocationId: value.invocationId ? redactSecretShapes(value.invocationId) : undefined,
  promptStamp: value.promptStamp ? redactSecretShapes(value.promptStamp) : undefined,
  status: value.status,
  startedAtMs: value.startedAtMs,
  toolCalls: value.toolCalls?.map(redactSecretShapes),
  aiCalls: value.aiCalls,
  model: value.model === null ? null : redactSecretShapes(value.model),
  usage: value.usage === null ? null : {
    promptTokens: value.usage.promptTokens, completionTokens: value.usage.completionTokens,
    totalTokens: value.usage.totalTokens, cachedPromptTokens: value.usage.cachedPromptTokens,
  },
  latencyMs: value.latencyMs,
  traceId: value.traceId === null ? null : redactSecretShapes(value.traceId),
  estimatedCostUsd: value.estimatedCostUsd,
});

export const invocationBranches = (
  invocations: readonly OfficeInvocationRecord[],
  events: readonly CoordinationEvent[],
  eventNode: (event: CoordinationEvent) => OperationTraceNode,
): OperationTraceNode[] => {
  const handoffs = new Map<string, OperationTraceNode>();
  for (const invocation of invocations) {
    const handoffId = invocation.handoffId ?? `unattributed:${invocation.invocationId}`;
    let handoff = handoffs.get(handoffId);
    if (!handoff) {
      handoff = { id: redactSecretShapes(handoffId), kind: 'handoff', label: redactSecretShapes(handoffId), children: [] };
      handoffs.set(handoffId, handoff);
    }
    const measurement = traceMeasurement(invocation.measurement);
    const modelNode: OperationTraceNode = {
      id: redactSecretShapes(`${invocation.invocationId}:model`), kind: 'model-call',
      label: measurement.model ?? 'Modelo sin identificar', measurement,
      status: invocation.status === 'completed' ? 'ok' : 'failed',
      children: (measurement.toolCalls ?? []).map((name, index) => ({
        id: redactSecretShapes(`${invocation.invocationId}:tool:${index}`), kind: 'event', label: `Solicitud de herramienta: ${name}`, children: [],
      })),
    };
    handoff.children.push({
      id: redactSecretShapes(invocation.invocationId), kind: 'invocation',
      label: redactSecretShapes(`${invocation.personaId} · ${invocation.role} · ${invocation.attempt}`),
      status: invocation.status === 'completed' ? 'ok' : 'failed',
      prompt: redactSecretShapes(invocation.promptStamp),
      elapsedMs: measurement.latencyMs,
      measurement,
      children: [modelNode, ...events.filter((event) => event.invocationId === invocation.invocationId).map(eventNode)],
    });
  }
  return [...handoffs.values()];
};

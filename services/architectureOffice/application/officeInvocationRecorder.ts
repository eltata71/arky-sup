import { newTraceId } from '../../../lib/traceId';
import { agentPromptRef, stampPrompt, type AgentPromptId } from '../../../lib/agents/promptCatalog';
import { summarizeAgentUsage, type AgentInvocationMeasurement } from '../../../lib/ai/agentUsage';
import type { AIJsonSchema } from '../../ai';
import type { ContextManifest } from '../domain/agentContextPolicy';
import type { OfficeAgentId } from '../domain/officeAgentPersonas';
import type { OfficeAgentInvoker, OfficeInvocationRecord, OfficeOrchestrationOptions, OfficeOrchestrationPlan, OfficeOrchestrationResult } from './officeOrchestrationTypes';
import { HandoffBudgetExhausted } from './handoffBudget';

/** One local recorder per operation. Completion order never changes invocation identity. */
export const createOfficeInvocationRecorder = (
  plan: OfficeOrchestrationPlan,
  operationInvoke: OfficeAgentInvoker,
  options: OfficeOrchestrationOptions,
) => {
  const promptStamps: string[] = [];
  const invocations: OfficeInvocationRecord[] = [];
  const measurements: { personaId: OfficeAgentId; value: AgentInvocationMeasurement }[] = [];
  const usage = (): OfficeOrchestrationResult['usage'] => ({
    total: summarizeAgentUsage(measurements.map((item) => item.value)),
    byAgent: Object.fromEntries([...new Set(measurements.map((item) => item.personaId))].map((personaId) => [
      personaId,
      summarizeAgentUsage(measurements.filter((item) => item.personaId === personaId).map((item) => item.value)),
    ])),
  });
  const invokeStamped = async (
    personaId: OfficeAgentId, instruction: string, promptId: AgentPromptId,
    delegate: OfficeAgentInvoker = operationInvoke, responseSchema?: AIJsonSchema,
    handoffId?: string, workstreamId?: string, contextManifest?: ContextManifest,
  ): Promise<string> => {
    if (options.signal?.aborted) throw new Error('Operación cancelada por la persona.');
    const stamp = stampPrompt(agentPromptRef(promptId), instruction);
    promptStamps.push(stamp);
    const startedAt = Date.now();
    const invocationId = newTraceId('office-invocation');
    const record: OfficeInvocationRecord = {
      invocationId, personaId, promptId, promptStamp: stamp,
      role: personaId === plan.coordinatorId ? 'coordinator' : personaId === plan.consolidatorId ? 'consolidator' : 'specialist',
      handoffId: handoffId ?? `${plan.operationId}:intake`, workstreamId,
      ...(contextManifest ? { contextManifest } : {}),
      attempt: promptId === 'office.consolidation-refinement' ? 'refinement' : 'primary',
      status: 'failed', startedAtMs: startedAt,
      measurement: { model: null, usage: null, latencyMs: 0, traceId: null, estimatedCostUsd: null },
    };
    invocations.push(record);
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 90_000;
    const aborted = () => controller.abort();
    options.signal?.addEventListener('abort', aborted, { once: true });
    const timer = setTimeout(aborted, timeoutMs);
    let rejectOnAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = () => reject(new Error(options.signal?.aborted ? 'Operación cancelada por la persona.' : 'Tiempo de invocación agotado.'));
      controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    try {
      const result = await Promise.race([
        delegate(personaId, instruction, stamp, { operationId: options.runId ?? plan.operationId, invocationId,
          handoffId: record.handoffId, signal: controller.signal, timeoutMs, ...(responseSchema ? { responseSchema } : {}) }),
        abortPromise,
      ]);
      // Whitelist accounting; an injected invoker may carry additional private fields.
      record.measurement = typeof result === 'string'
        ? { model: null, usage: null, latencyMs: Date.now() - startedAt, traceId: null, estimatedCostUsd: null }
        : { model: result.model, usage: result.usage, latencyMs: result.latencyMs, traceId: result.traceId,
          estimatedCostUsd: result.estimatedCostUsd, aiCalls: result.aiCalls, toolCalls: result.toolCalls };
      record.status = 'completed';
      return typeof result === 'string' ? result : result.text;
    } catch (error) {
      record.measurement.latencyMs = Date.now() - startedAt;
      // A rejected budget did not call a model.
      if (error instanceof HandoffBudgetExhausted) record.measurement.aiCalls = 0;
      throw error;
    } finally {
      record.measurement = { ...record.measurement,
        runId: options.runId ?? plan.operationId, invocationId, promptStamp: stamp,
        status: record.status, startedAtMs: startedAt };
      measurements.push({ personaId, value: record.measurement });
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', aborted);
      if (rejectOnAbort) controller.signal.removeEventListener('abort', rejectOnAbort);
    }
  };
  return { promptStamps, invocations, usage, invokeStamped };
};

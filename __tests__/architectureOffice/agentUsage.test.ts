import { describe, expect, it } from 'vitest';
import { estimateAgentCostUsd, summarizeAgentUsage } from '../../lib/ai/agentUsage';
import { executeOfficeOrchestration, planOfficeWorkstreams } from '../../services/architectureOffice/application/officeOrchestration';

describe('medición de una operación de la Oficina', () => {
  it('conserva tokens y latencia por agente y nunca convierte uso ausente en cero', async () => {
    const plan = planOfficeWorkstreams('Lucía coordina una revisión de arquitectura de software.');
    // Un especialista sin uso informado: el total no puede presentarse como medido.
    const unmeasured = plan.workstreams[0].personaId;
    let calls = 0;
    const result = await executeOfficeOrchestration(plan, async (personaId) => {
      calls += 1;
      return {
        text: personaId === 'alejandro' ? 'Ready: recomendación con evidencia.' : 'Análisis de arquitectura con evidencia.',
        model: 'gemini-2.5-flash',
        usage: personaId === unmeasured ? null : { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
        latencyMs: 25,
        traceId: `trace-${calls}`,
        estimatedCostUsd: personaId === unmeasured ? null : estimateAgentCostUsd('gemini-2.5-flash', { promptTokens: 100, completionTokens: 20 }),
      };
    }, { maxConsolidationRefinements: 0 });

    expect(result.usage.total.calls).toBe(calls);
    expect(result.usage.total.measuredCalls).toBe(calls - 1);
    expect(result.usage.total.totalTokens).toBeNull();
    expect(result.usage.total.estimatedCostUsd).toBeNull();
    expect(result.usage.total.latencyMs).toBe(calls * 25);
    expect(result.usage.byAgent[unmeasured]?.totalTokens).toBeNull();
    expect(result.usage.byAgent.lucia).toBeUndefined();
    expect(result.usage.byAgent.alejandro?.totalTokens).toBe(120);
  });

  it('deja el coste sin medir si hay caché o un modelo sin precio fechado', () => {
    expect(estimateAgentCostUsd('gemini-2.5-flash', { promptTokens: 100, completionTokens: 20, cachedPromptTokens: 10 })).toBeNull();
    expect(estimateAgentCostUsd('gemini-3.1-flash-lite', { promptTokens: 1_000_000, completionTokens: 1_000_000 })).toBe(1.75);
    expect(estimateAgentCostUsd('otro-modelo', { promptTokens: 100, completionTokens: 20 })).toBeNull();
    expect(summarizeAgentUsage([]).totalTokens).toBeNull();
  });
});

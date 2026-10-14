import { describe, expect, it } from 'vitest';
import { HandoffBudgetExhausted, withHandoffBudget } from '../../services/architectureOffice/application/handoffBudget';
import { executeOfficeOrchestration, planOfficeWorkstreams } from '../../services/architectureOffice/application/officeOrchestration';

describe('presupuestos y cancelación de la Oficina', () => {
  it('cobra las llamadas reales informadas por el invocador y rechaza la siguiente', async () => {
    let providerCalls = 0;
    const invoke = withHandoffBudget(async () => {
      providerCalls += 3;
      return { text: 'hecho', aiCalls: 3, model: 'gemini-2.5-flash', usage: { totalTokens: 120 }, latencyMs: 10, traceId: 'trace-1', estimatedCostUsd: null };
    }, { budget: { maxAiCalls: 3, maxTokens: 1000 } });
    await invoke('carmen', 'primera');
    await expect(invoke('carmen', 'segunda')).rejects.toBeInstanceOf(HandoffBudgetExhausted);
    expect(providerCalls).toBe(3);
  });

  it('reports a budget-exhausted rejection instead of silently skipping a specialist', async () => {
    const plan = planOfficeWorkstreams('Lucía coordina una revisión de arquitectura.');
    plan.workstreams = [
      { id: 'ws-1', personaId: 'carmen', objective: 'Revisar', acceptanceCriteria: ['Evidencia'] },
      { id: 'ws-2', personaId: 'gabriel', objective: 'Revisar', acceptanceCriteria: ['Evidencia'] },
    ];
    const result = await executeOfficeOrchestration(plan, async () => ({
      text: 'Análisis con evidencia.', aiCalls: 1, model: 'gemini-2.5-flash',
      usage: { totalTokens: 100 }, latencyMs: 5, traceId: 'trace-1', estimatedCostUsd: null,
    }), { maxAiCalls: 2, maxConsolidationRefinements: 0 });
    expect(result.usage.total.calls).toBe(2);
    expect(result.rejectedHandoffs?.some((handoff) => handoff.rejections.some((item) => item.code === 'budget-exhausted'))).toBe(true);
  });

  it('corta la operación a mitad de especialistas sin consolidar', async () => {
    const controller = new AbortController();
    const plan = planOfficeWorkstreams('Lucía coordina una revisión de arquitectura.');
    plan.workstreams = [{ id: 'ws-1', personaId: 'carmen', objective: 'Revisar', acceptanceCriteria: ['Evidencia'] }];
    let started: (() => void) | undefined;
    const specialistStarted = new Promise<void>((resolve) => { started = resolve; });
    let consolidations = 0;
    const run = executeOfficeOrchestration(plan, async (personaId) => {
      if (personaId === 'lucia') return 'Brief';
      if (personaId === 'alejandro') { consolidations += 1; return 'Ready'; }
      started?.();
      return new Promise<string>(() => {});
    }, { signal: controller.signal });
    await specialistStarted;
    controller.abort();
    const result = await run;
    expect(result.status).toBe('failed');
    expect(result.consolidation).toMatch(/cancelada/);
    expect(consolidations).toBe(0);
  });
});

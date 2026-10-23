/**
 * Las cifras del panel de calidad de agentes (plan de agentes 20.1).
 */
import { describe, expect, it } from 'vitest';
import { buildAgentQualityReport } from '../../services/architectureOffice/application/agentQuality';
import type { OfficeEngagement, OfficeTask } from '../../services/architectureOffice/domain/OfficeTypes';
import type { AgentInvocationMeasurement } from '../../lib/ai/agentUsage';

const NOW = Date.parse('2026-10-23T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();

const measurement = (latencyMs: number, estimatedCostUsd: number | null): AgentInvocationMeasurement => ({
  model: 'gemini-2.5-flash',
  usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  latencyMs,
  traceId: null,
  estimatedCostUsd,
});

const task = (patch: Partial<OfficeTask>): OfficeTask => ({
  id: `t-${Math.random().toString(36).slice(2, 8)}`,
  engagementId: 'e1',
  kind: 'produce-artifact',
  title: 'T',
  objective: 'O',
  assigneeId: 'elena',
  dependsOn: [],
  acceptanceCriteria: [],
  status: 'completed',
  attempts: 1,
  maxAttempts: 3,
  completedAt: daysAgo(1),
  ...patch,
});

const engagement = (tasks: OfficeTask[]): OfficeEngagement => ({ id: 'e1', tasks } as unknown as OfficeEngagement);

describe('buildAgentQualityReport', () => {
  it('sin encargos no hay filas: sin medir, no ceros', () => {
    expect(buildAgentQualityReport([], 30, NOW).rows).toEqual([]);
  });

  it('la ventana deja fuera lo anterior y lo que no tiene fecha', () => {
    const report = buildAgentQualityReport([engagement([
      task({ completedAt: daysAgo(2) }),
      task({ completedAt: daysAgo(10) }),
      task({ completedAt: undefined, startedAt: undefined, createdAt: undefined }),
    ])], 7, NOW);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].tasks).toBe(1);
    expect(buildAgentQualityReport([engagement([task({ completedAt: daysAgo(10) })])], 30, NOW).rows[0].tasks).toBe(1);
  });

  it('la aprobación a la primera cuenta las terminadas con un solo intento', () => {
    const [row] = buildAgentQualityReport([engagement([
      task({ attempts: 1 }),
      task({ attempts: 1 }),
      task({ attempts: 3 }),
      task({ attempts: 1, status: 'failed' }),
    ])], 30, NOW).rows;
    expect(row.firstPassApprovalRate).toBeCloseTo(2 / 3);
    expect(row.retries).toBe(2);
  });

  it('sin entregas de producción terminadas la tasa es null, no 0', () => {
    const [row] = buildAgentQualityReport([engagement([
      task({ kind: 'review-artifact' }),
      task({ status: 'in-progress', attempts: 1 }),
    ])], 30, NOW).rows;
    expect(row.firstPassApprovalRate).toBeNull();
  });

  it('el coste sólo se suma si todas las llamadas traen estimación', () => {
    const complete = buildAgentQualityReport([engagement([
      task({ measurements: [measurement(100, 0.01), measurement(200, 0.02)] }),
    ])], 30, NOW).rows[0];
    expect(complete.estimatedCostUsd).toBeCloseTo(0.03);

    const partial = buildAgentQualityReport([engagement([
      task({ measurements: [measurement(100, 0.01), measurement(200, null)] }),
    ])], 30, NOW).rows[0];
    expect(partial.estimatedCostUsd).toBeNull();

    const none = buildAgentQualityReport([engagement([task({})])], 30, NOW).rows[0];
    expect(none.estimatedCostUsd).toBeNull();
  });

  it('la latencia es p50/p90 sobre las llamadas medidas; una latencia 0 es desconocida', () => {
    const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const [row] = buildAgentQualityReport([engagement([
      task({ measurements: [...latencies.map((ms) => measurement(ms, 0.001)), measurement(0, null)] }),
    ])], 30, NOW).rows;
    expect(row.latencyP50Ms).toBe(500);
    expect(row.latencyP90Ms).toBe(900);
    const unknown = buildAgentQualityReport([engagement([task({ measurements: [measurement(0, null)] })])], 30, NOW).rows[0];
    expect(unknown.latencyP50Ms).toBeNull();
    expect(unknown.latencyP90Ms).toBeNull();
  });

  it('los handoffs rechazados no se registran por encargo: se declara, no se inventa', () => {
    const [row] = buildAgentQualityReport([engagement([task({})])], 30, NOW).rows;
    expect(row.operationsWithRejectedHandoffs).toBeNull();
  });

  it('agrupa por quien firma la tarea y ordena por volumen', () => {
    const report = buildAgentQualityReport([engagement([
      task({ assigneeId: 'carmen' }),
      task({ assigneeId: 'elena' }),
      task({ assigneeId: 'elena' }),
    ])], 30, NOW);
    expect(report.rows.map((row) => `${row.agentId}:${row.tasks}`)).toEqual(['elena:2', 'carmen:1']);
  });
});

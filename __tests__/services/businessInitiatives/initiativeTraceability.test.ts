import { describe, expect, it } from 'vitest';
import { traceInitiativeTargets } from '../../../services/businessInitiatives';

const initiative = {
  id: 'i1',
  title: 'Reducir tiempo de emisión',
  expectedOutcomes: [{ id: 'o1', statement: 'Emisión en minutos' }, { id: 'o2', statement: 'Menos reprocesos' }],
  kpis: [{ id: 'k1', name: 'Tiempo medio', unit: 'min' }],
};

const contribution = (id: string, extra: Record<string, unknown>) => ({
  id, statement: `c-${id}`, state: 'planned' as const, ...extra,
});

describe('traceInitiativeTargets', () => {
  it('une por id y reporta lo que nadie sirve', () => {
    const trace = traceInitiativeTargets(initiative, {
      projectId: 'p1',
      contributions: [contribution('c1', { outcomeId: 'o1' }), contribution('c2', { kpiId: 'k1' })],
    });
    expect(trace.targets.find((t) => t.id === 'o1')?.claimedBy.map((c) => c.id)).toEqual(['c1']);
    expect(trace.unclaimed.map((t) => t.id)).toEqual(['o2']);
    expect(trace.dangling).toEqual([]);
  });

  it('informa las referencias rotas en vez de descartarlas', () => {
    const trace = traceInitiativeTargets(initiative, {
      projectId: 'p1',
      contributions: [contribution('c1', { outcomeId: 'gone' })],
    });
    expect(trace.dangling).toMatchObject([{ reason: 'unknown-outcome', reference: 'gone' }]);
    expect(trace.unclaimed).toHaveLength(3);
  });

  it('sin contribuciones, todo queda sin servir', () => {
    const trace = traceInitiativeTargets(initiative, { projectId: 'p1', contributions: [] });
    expect(trace.unclaimed).toHaveLength(3);
  });
});

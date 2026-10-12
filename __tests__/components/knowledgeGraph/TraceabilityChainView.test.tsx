import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const traces = vi.hoisted(() => ({ value: [] as unknown[] }));

vi.mock('../../../context/AppContext', () => ({
  useAppContext: () => ({
    t: (key: string, params?: Record<string, string>) => (params ? `${key}|${Object.values(params).join(',')}` : key),
  }),
}));
vi.mock('../../../context/InitiativeContext', () => ({ useInitiatives: () => ({ initiatives: [] }) }));
vi.mock('../../../hooks/useProjectInitiativeTraceability', () => ({
  useProjectInitiativeTraceability: () => traces.value,
}));
vi.mock('../../../services/architectureKnowledgeGraph', () => ({
  analyzeTraceabilityChains: () => ({ findings: [], chains: [] }),
  explainEntity: () => null,
}));

import TraceabilityChainView from '../../../components/knowledgeGraph/TraceabilityChainView';

const graph = {} as never;

describe('TraceabilityChainView · trazabilidad con la iniciativa', () => {
  it('marca lo no reclamado, lo reclamado y las referencias rotas', () => {
    traces.value = [{
      initiativeId: 'i1',
      initiativeTitle: 'Reducir siniestros',
      targets: [
        { kind: 'outcome', id: 'o1', label: 'Menos fraude', claimedBy: [{ statement: 'Motor antifraude' }] },
        { kind: 'kpi', id: 'k1', label: 'Tiempo de pago', claimedBy: [] },
      ],
      unclaimed: [],
      dangling: [{ contributionId: 'c9', reason: 'missing-kpi', reference: 'k-borrado' }],
    }];
    render(<TraceabilityChainView graph={graph} artifacts={[]} />);
    expect(screen.getByText('Reducir siniestros')).toBeTruthy();
    expect(screen.getByText(/Menos fraude/).textContent).toContain('Motor antifraude');
    expect(screen.getByText(/Tiempo de pago/).textContent).toContain('kg.chainUnclaimed');
    expect(screen.getByText('kg.chainDangling|k-borrado')).toBeTruthy();
  });

  it('sin iniciativas servidas no pinta sección', () => {
    traces.value = [];
    render(<TraceabilityChainView graph={graph} artifacts={[]} />);
    expect(screen.queryByText(/kg.chainUnclaimed/)).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { resolveEdgeRoutingDecision } from '../../services/diagram/edgeRoutingPolicy';
import type { DiagramIR } from '../../lib/diagram';

const ir = (diagramType: NonNullable<DiagramIR['metadata']>['diagramType']): DiagramIR => ({
  nodes: [{ id: 'a', label: 'A', kind: 'service' }, { id: 'b', label: 'B', kind: 'service' }],
  edges: [{ id: 'e1', source: 'a', target: 'b', label: 'x', relation: 'sync' }],
  groups: [],
  metadata: { diagramType },
});

describe('edgeRoutingPolicy', () => {
  it('prefers orthogonal + lane-aware for integration diagrams', () => {
    const decision = resolveEdgeRoutingDecision(ir('integration'), ir('integration').edges[0]);
    expect(decision.preferredStyle).toBe('orthogonal');
    expect(decision.laneAware).toBe(true);
  });

  it('sets avoidCrossBoundary for BPMN', () => {
    const decision = resolveEdgeRoutingDecision(ir('bpmn-process'), ir('bpmn-process').edges[0]);
    expect(decision.avoidCrossBoundary).toBe(true);
  });
});

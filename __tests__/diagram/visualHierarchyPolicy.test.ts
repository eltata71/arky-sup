import { describe, expect, it } from 'vitest';
import { resolveEdgeHierarchy, resolveNodeHierarchy } from '../../services/diagram/visualHierarchyPolicy';
import type { DiagramIR } from '../../lib/diagram';

const baseIR: DiagramIR = {
  nodes: [{ id: 'n1', label: 'Core API', kind: 'service', criticality: 'high' }],
  edges: [{ id: 'e1', source: 'n1', target: 'n1', label: 'dep', relation: 'dependency' }],
  groups: [],
  metadata: { audience: 'executive' },
};

describe('visualHierarchyPolicy', () => {
  it('promotes critical nodes to risk/high', () => {
    const d = resolveNodeHierarchy(baseIR, baseIR.nodes[0], 'executive');
    expect(d.level).toBe('risk');
    expect(d.emphasis).toBe('high');
  });

  it('demotes dependency edges for executive audience', () => {
    const d = resolveEdgeHierarchy(baseIR, baseIR.edges[0], 'executive');
    expect(d.hideByDefault).toBe(true);
    expect(d.emphasis).toBe('low');
  });
});


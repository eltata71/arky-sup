import { describe, expect, it } from 'vitest';
import { irToReactFlow } from '../../services/diagram/irToReactFlow';
import type { DiagramIR } from '../../lib/diagram';

describe('irToReactFlow routing enrichment', () => {
  it('marks repeated group-to-group edges as bundled and secondary defaults', () => {
    const ir: DiagramIR = {
      nodes: [
        { id: 'a1', label: 'A1', kind: 'service', group: 'A' },
        { id: 'a2', label: 'A2', kind: 'service', group: 'A' },
        { id: 'b1', label: 'B1', kind: 'service', group: 'B' },
        { id: 'b2', label: 'B2', kind: 'service', group: 'B' },
      ],
      edges: [
        { id: 'e1', source: 'a1', target: 'b1', label: 'dep', relation: 'dependency' },
        { id: 'e2', source: 'a2', target: 'b1', label: 'dep', relation: 'dependency' },
        { id: 'e3', source: 'a1', target: 'b2', label: 'dep', relation: 'dependency' },
      ],
      groups: [{ id: 'A', label: 'A', nodeIds: ['a1', 'a2'] }, { id: 'B', label: 'B', nodeIds: ['b1', 'b2'] }],
      metadata: { diagramType: 'integration' },
    };
    const rf = irToReactFlow(ir);
    expect(rf.edges.length).toBe(3);
    expect(rf.edges.every((e) => (e.data as { bundled?: boolean }).bundled === true)).toBe(true);
    expect(rf.edges.every((e) => (e.data as { crossBoundary?: boolean }).crossBoundary === true)).toBe(true);
  });
});


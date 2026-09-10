import { describe, it, expect } from 'vitest';
import { EmptyIRError, irToReactFlow } from '../../services/diagram/irToReactFlow';
import type { DiagramIR } from '../../lib/diagram';

const emptyIR: DiagramIR = { nodes: [], edges: [], groups: [] };

describe('irToReactFlow — empty IR contract', () => {
    it('throws EmptyIRError when IR has zero nodes by default', () => {
        expect(() => irToReactFlow(emptyIR)).toThrow(EmptyIRError);
    });

    it('returns a visible placeholder when allowEmptyPlaceholder is true', () => {
        const result = irToReactFlow(emptyIR, { allowEmptyPlaceholder: true });
        expect(result.nodes).toHaveLength(1);
        expect(result.edges).toHaveLength(0);
        expect(result.nodes[0].data.label).toMatch(/no disponible/i);
    });

    it('renders normally for IR with at least one node', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'A', kind: 'Component' },
                { id: 'b', label: 'B', kind: 'Component' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'calls' }],
            groups: [],
        };
        const result = irToReactFlow(ir);
        expect(result.nodes).toHaveLength(2);
        expect(result.edges).toHaveLength(1);
    });
});

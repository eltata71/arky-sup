import { describe, it, expect } from 'vitest';
import { projectIR } from '../../services/diagram/audienceProjector';
import type { DiagramIR } from '../../lib/diagram';

function buildIR(): DiagramIR {
    return {
        nodes: [
            { id: 'user', label: 'Customer', kind: 'Person' },
            { id: 'api', label: 'API Gateway', kind: 'Gateway' },
            { id: 'svcA', label: 'Svc A', kind: 'Service', group: 'Core' },
            { id: 'svcB', label: 'Svc B', kind: 'Service', group: 'Core' },
            { id: 'db', label: 'Database', kind: 'Data' },
        ],
        edges: [
            { id: 'e1', source: 'user', target: 'api', label: 'Request' },
            { id: 'e2', source: 'api', target: 'svcA', label: 'Invoke' },
            { id: 'e3', source: 'svcA', target: 'svcB', label: 'Internal' },
            { id: 'e4', source: 'svcB', target: 'db', label: 'Persist' },
        ],
        groups: [{ id: 'g1', label: 'Core', nodeIds: ['svcA', 'svcB'] }],
    };
}

describe('audienceProjector', () => {
    it('executive projection collapses internal group into a single subsystem node', () => {
        const ir = projectIR(buildIR(), 'executive');
        expect(ir.metadata?.audience).toBe('executive');
        expect(ir.nodes.length).toBeLessThanOrEqual(4);
        expect(ir.nodes.some(n => n.kind === 'Subsystem')).toBe(true);
    });

    it('technical projection preserves detail', () => {
        const ir = projectIR(buildIR(), 'technical');
        expect(ir.nodes.length).toBe(5);
        expect(ir.metadata?.audience).toBe('technical');
    });

    it('operations projection flattens groups and marks async/data-flow edges', () => {
        const src = buildIR();
        src.edges[3].relation = 'data-flow';
        const ir = projectIR(src, 'operations');
        expect(ir.groups.length).toBe(0);
        expect(ir.edges.find(e => e.id === 'e4')?.label?.startsWith('*')).toBe(true);
    });
});

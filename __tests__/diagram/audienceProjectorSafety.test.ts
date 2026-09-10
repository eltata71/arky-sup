import { describe, it, expect } from 'vitest';
import { projectIR } from '../../services/diagram/audienceProjector';
import type { DiagramIR } from '../../lib/diagram';

const baseIR: DiagramIR = {
    nodes: [
        { id: 'cli', label: 'Cliente', kind: 'person' },
        { id: 'api', label: 'API',     kind: 'service' },
        { id: 'db',  label: 'DB',      kind: 'data' },
    ],
    edges: [
        { id: 'e1', source: 'cli', target: 'api', label: 'Solicita' },
        { id: 'e2', source: 'api', target: 'db',  label: 'Persiste' },
    ],
    groups: [],
    metadata: { audience: 'technical', sourceFormat: 'mermaid' },
};

describe('projectIR — empty-projection safety net', () => {
    it('falls back to the original IR when a projection would empty the canvas', () => {
        // An IR whose every node has kind: 'process' will be filtered by the
        // executive projection (which only keeps person/system/gateway/data/
        // external prioritisedRoles AND collapses ungrouped non-promoted nodes).
        // We synthesise the worst case: all nodes are 'process' AND ungrouped.
        const ir: DiagramIR = {
            nodes: [
                { id: 'p1', label: 'Pipeline 1', kind: 'process' },
            ],
            edges: [],
            groups: [],
            metadata: { sourceFormat: 'mermaid' },
        };
        const projected = projectIR(ir, 'executive');
        // Even when the projection would otherwise return zero nodes, the
        // safety net guarantees at least the original content survives.
        expect(projected.nodes.length).toBeGreaterThan(0);
        expect(projected.metadata?.audience).toBe('executive');
    });

    it('keeps a normal projection when it has content', () => {
        const projected = projectIR(baseIR, 'technical');
        expect(projected.nodes.length).toBeGreaterThanOrEqual(2);
    });

    it('does not artificially populate when the input IR is genuinely empty', () => {
        const projected = projectIR({ nodes: [], edges: [], groups: [] }, 'executive');
        expect(projected.nodes.length).toBe(0);
    });

    it('attaches the audience metadata even on the safety-net path', () => {
        const ir: DiagramIR = {
            nodes: [{ id: 'p1', label: 'p', kind: 'process' }],
            edges: [],
            groups: [],
        };
        const projected = projectIR(ir, 'operations');
        expect(projected.metadata?.audience).toBe('operations');
    });
});

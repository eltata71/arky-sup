import { describe, it, expect } from 'vitest';
import { selectLayoutPlan, selectFallbackPlan, DENSITY_SCALE } from '../../lib/layoutSelector';
import type { DiagramIR } from '../../lib/diagram';

function smallIR(): DiagramIR {
    return {
        nodes: [
            { id: 'a', label: 'A', kind: 'service' },
            { id: 'b', label: 'B', kind: 'service' },
        ],
        edges: [{ id: 'e', source: 'a', target: 'b', label: 'rel' }],
        groups: [],
    };
}

function manyNodesIR(count: number): DiagramIR {
    const nodes = Array.from({ length: count }).map((_, i) => ({
        id: `n-${i}`,
        label: `Node ${i}`,
        kind: 'service',
    }));
    const edges = nodes.slice(1).map((n, i) => ({
        id: `e-${i}`,
        source: nodes[0].id,
        target: n.id,
        label: 'rel',
    }));
    return { nodes, edges, groups: [] };
}

describe('LayoutPlan density (Gap 3)', () => {
    it('every plan returned by selectLayoutPlan carries a density', () => {
        const plan = selectLayoutPlan({ ir: smallIR(), artifactType: 'mermaid-graph' });
        expect(plan.density).toBeDefined();
        expect(['compact', 'normal', 'spacious']).toContain(plan.density);
    });

    it('selectFallbackPlan preserves the density from the original plan', () => {
        const elkPlan = selectLayoutPlan({
            ir: smallIR(),
            artifactType: 'mermaid-c4-container',
        });
        const fallback = selectFallbackPlan({
            ir: smallIR(),
            artifactType: 'mermaid-c4-container',
        });
        expect(fallback.density).toBe(elkPlan.density);
        expect(fallback.backend).toBe('dagre');
    });

    it('value-stream diagrams pick spacious density to fit LT/PT labels', () => {
        const ir: DiagramIR = {
            ...smallIR(),
            metadata: { diagramType: 'value-stream' },
        };
        const plan = selectLayoutPlan({ ir, artifactType: 'mermaid-graph' });
        expect(plan.density).toBe('spacious');
    });

    it('large C4 container diagrams pick compact density', () => {
        const ir: DiagramIR = {
            ...manyNodesIR(20),
            metadata: { diagramType: 'c4-container' },
        };
        const plan = selectLayoutPlan({ ir, artifactType: 'mermaid-c4-container' });
        expect(plan.density).toBe('compact');
    });

    it('DENSITY_SCALE exposes spacing multipliers for every density token', () => {
        expect(DENSITY_SCALE.compact).toBeLessThan(1);
        expect(DENSITY_SCALE.normal).toBe(1);
        expect(DENSITY_SCALE.spacious).toBeGreaterThan(1);
    });
});

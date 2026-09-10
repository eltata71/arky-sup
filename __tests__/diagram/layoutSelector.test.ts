import { describe, it, expect } from 'vitest';
import { selectLayoutPlan, selectFallbackPlan } from '../../lib/layoutSelector';
import type { DiagramIR } from '../../lib/diagram';

function meshIR(serviceCount: number): DiagramIR {
    const nodes = Array.from({ length: serviceCount }).map((_, i) => ({
        id: `svc-${i}`,
        label: `Service ${i}`,
        kind: 'service',
    }));
    const edges = nodes.slice(1).map((n, i) => ({
        id: `e-${i}`,
        source: nodes[0].id,
        target: n.id,
        label: 'Invoca',
    }));
    return { nodes, edges, groups: [] };
}

describe('layoutSelector', () => {
    it('picks ELK radial for C4 Context with hub topology', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'sys', label: 'Sistema', kind: 'system' },
                { id: 'a', label: 'Cliente', kind: 'person' },
                { id: 'b', label: 'Auditor', kind: 'person' },
                { id: 'c', label: 'Stripe', kind: 'external' },
                { id: 'd', label: 'AWS', kind: 'external' },
                { id: 'e', label: 'Slack', kind: 'external' },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'sys', label: 'Usa' },
                { id: 'e2', source: 'b', target: 'sys', label: 'Audita' },
                { id: 'e3', source: 'sys', target: 'c', label: 'Cobra' },
                { id: 'e4', source: 'sys', target: 'd', label: 'Hospeda' },
                { id: 'e5', source: 'sys', target: 'e', label: 'Notifica' },
            ],
            groups: [],
        };
        const plan = selectLayoutPlan({ ir, artifactType: 'mermaid-c4-context' });
        expect(plan.backend).toBe('elk');
        expect(plan.algorithm).toBe('radial');
    });

    it('picks ELK force for ERD diagrams', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'Customer', kind: 'data' },
                { id: 'b', label: 'Order', kind: 'data' },
                { id: 'c', label: 'Payment', kind: 'data' },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'b', label: 'has' },
                { id: 'e2', source: 'b', target: 'c', label: 'has' },
            ],
            groups: [],
        };
        const plan = selectLayoutPlan({ ir, artifactType: 'mermaid-erd' });
        expect(plan.backend).toBe('elk');
        expect(plan.algorithm).toBe('force');
    });

    it('picks ELK mrtree for service meshes', () => {
        const plan = selectLayoutPlan({ ir: meshIR(13), artifactType: 'mermaid-graph' });
        expect(plan.backend).toBe('elk');
        expect(plan.algorithm).toBe('mrtree');
    });

    it('falls back to dagre for sequence diagrams', () => {
        const plan = selectLayoutPlan({
            ir: { nodes: [{ id: 'a', label: 'A', kind: 'service' }], edges: [], groups: [] },
            artifactType: 'mermaid-sequence',
        });
        expect(plan.backend).toBe('dagre');
    });

    it('applies semantic policy for BPMN as ELK layered LR', () => {
        const plan = selectLayoutPlan({
            ir: {
                nodes: [{ id: 's', label: 'Start', kind: 'event' }, { id: 't', label: 'Task', kind: 'process' }],
                edges: [{ id: 'e1', source: 's', target: 't', label: 'next' }],
                groups: [],
                metadata: { diagramType: 'bpmn-process' },
            },
            artifactType: 'mermaid-graph',
        });
        expect(plan.backend).toBe('elk');
        expect(plan.algorithm).toBe('layered');
        expect(plan.direction).toBe('LR');
        expect(plan.orthogonal).toBe(true);
    });

    it('applies semantic policy for integration with spacious density', () => {
        const plan = selectLayoutPlan({
            ir: {
                nodes: [{ id: 'a', label: 'Channel', kind: 'system' }, { id: 'b', label: 'Gateway', kind: 'service' }],
                edges: [{ id: 'e1', source: 'a', target: 'b', label: 'API' }],
                groups: [],
                metadata: { diagramType: 'integration' },
            },
            artifactType: 'mermaid-graph',
        });
        expect(plan.backend).toBe('elk');
        expect(plan.direction).toBe('LR');
        expect(plan.density).toBe('spacious');
    });

    it('selectFallbackPlan returns dagre when ELK was the first choice', () => {
        const plan = selectFallbackPlan({
            ir: { nodes: [{ id: 'a', label: 'A', kind: 'service' }, { id: 'b', label: 'B', kind: 'service' }], edges: [], groups: [] },
            artifactType: 'mermaid-c4-container',
        });
        expect(plan.backend).toBe('dagre');
    });
});

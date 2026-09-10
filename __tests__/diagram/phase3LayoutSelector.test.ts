import { describe, it, expect } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { selectLayoutPlan } from '../../lib/layoutSelector';

const ir = (overrides: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: [
        { id: 'a', label: 'A', kind: 'system' },
        { id: 'b', label: 'B', kind: 'system' },
        { id: 'c', label: 'C', kind: 'system' },
    ],
    edges: [],
    groups: [],
    metadata: {},
    ...overrides,
});

describe('Phase 3 — layoutSelector diagramType awareness', () => {
    it('picks ELK layered LR + orthogonal for BPMN processes', () => {
        const plan = selectLayoutPlan({ ir: ir({ metadata: { diagramType: 'bpmn-process' } }) });
        expect(plan.backend).toBe('elk');
        expect(plan.algorithm).toBe('layered');
        expect(plan.direction).toBe('LR');
        expect(plan.orthogonal).toBe(true);
    });

    it('picks ELK layered LR for value-stream maps regardless of size', () => {
        const plan = selectLayoutPlan({ ir: ir({ metadata: { diagramType: 'value-stream' } }) });
        expect(plan.backend).toBe('elk');
        expect(plan.direction).toBe('LR');
    });

    it('picks ELK layered LR for integration archetypes under 18 nodes', () => {
        const plan = selectLayoutPlan({ ir: ir({ metadata: { diagramType: 'integration' } }) });
        expect(plan.direction).toBe('LR');
        expect(plan.orthogonal).toBe(true);
    });

    it('switches integration to TB once the node count exceeds 18', () => {
        const many: DiagramIR['nodes'] = Array.from({ length: 20 }, (_, i) => ({
            id: `n${i}`,
            label: `Node ${i}`,
            kind: 'system',
        }));
        const plan = selectLayoutPlan({ ir: ir({ nodes: many, metadata: { diagramType: 'integration' } }) });
        expect(plan.direction).toBe('TB');
    });

    it('picks ELK layered TB for c4-container', () => {
        const plan = selectLayoutPlan({ ir: ir({ metadata: { diagramType: 'c4-container' } }) });
        expect(plan.direction).toBe('TB');
        expect(plan.orthogonal).toBe(true);
    });

    it('keeps dagre for sequence diagrams regardless of diagramType metadata', () => {
        const plan = selectLayoutPlan({
            ir: ir({ metadata: { diagramType: 'sequence' } }),
            artifactType: 'mermaid-sequence',
        });
        expect(plan.backend).toBe('dagre');
    });
});

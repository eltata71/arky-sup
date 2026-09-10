import { describe, it, expect } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import { autoRepairDiagramIR } from '../../services/diagram/qualityRepair';
import { analyzeDiagramQuality } from '../../services/diagram/quality/diagramQualityService';

const baseArtifact = {
    name: 'Flujo de Reservas',
    type: 'mermaid-graph' as const,
    objective: 'Mostrar el flujo de reservas',
    audience: 'technical' as const,
    theme: 'editorial' as const,
};

describe('autoRepairDiagramIR', () => {
    it('connects orphan nodes to a meaningful hub', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'svc', label: 'Order Service', kind: 'service' },
                { id: 'db', label: 'Orders DB', kind: 'data' },
                { id: 'orphan', label: 'Audit Log', kind: 'data' },
            ],
            edges: [{ id: 'e1', source: 'svc', target: 'db', label: 'Persiste' }],
            groups: [],
        };
        const before = analyzeDiagramQuality(ir);
        const orphanIssue = before.issues.find((i) => i.code === 'ORPHAN_NODE');
        expect(orphanIssue).toBeTruthy();

        const result = autoRepairDiagramIR(ir, { artifact: baseArtifact });
        const after = analyzeDiagramQuality(result.ir);
        expect(after.issues.filter((i) => i.code === 'ORPHAN_NODE')).toHaveLength(0);
        expect(result.applied.find((c) => c.code === 'ORPHAN_RECONNECTED')).toBeTruthy();
    });

    it('replaces empty/generic edge labels with verb-driven phrases', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'svc', label: 'API', kind: 'service' },
                { id: 'db', label: 'Orders', kind: 'data' },
            ],
            edges: [
                { id: 'e1', source: 'svc', target: 'db', label: '' },
                { id: 'e2', source: 'svc', target: 'db', label: 'data' },
            ],
            groups: [],
        };
        const result = autoRepairDiagramIR(ir, { artifact: baseArtifact });
        for (const edge of result.ir.edges) {
            expect(edge.label.trim()).not.toBe('');
            expect(edge.label.trim().toLowerCase()).not.toBe('data');
        }
        expect(result.applied.find((c) => c.code === 'EDGE_LABEL_FILLED')).toBeTruthy();
    });

    it('humanises labels that are equal to the node id when opt-in is enabled', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'order-service', label: 'order-service', kind: 'service' },
                { id: 'orders-db', label: 'orders-db', kind: 'data' },
            ],
            edges: [{ id: 'e1', source: 'order-service', target: 'orders-db', label: 'Persiste' }],
            groups: [],
        };
        // Without opt-in, the label is preserved (visual stability).
        const conservative = autoRepairDiagramIR(ir, { artifact: baseArtifact });
        expect(conservative.ir.nodes.find((n) => n.id === 'order-service')?.label).toBe('order-service');
        // With opt-in, the label is humanised.
        const aggressive = autoRepairDiagramIR(ir, { artifact: baseArtifact, humaniseLabels: true });
        expect(aggressive.ir.nodes.find((n) => n.id === 'order-service')?.label).toBe('Order Service');
    });

    it('drops dangling edges before repairing other content', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'A', kind: 'service' },
                { id: 'b', label: 'B', kind: 'service' },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'b', label: 'Sync' },
                { id: 'e2', source: 'a', target: 'missing', label: 'Phantom' },
            ],
            groups: [],
        };
        const result = autoRepairDiagramIR(ir, { artifact: baseArtifact });
        // The dangling edge is dropped — but `b` becomes orphan when its only
        // sibling now has zero outbound edges (we removed e2, kept e1, so b is
        // still connected). Either way no edge points to "missing".
        expect(result.ir.edges.find((e) => e.target === 'missing')).toBeUndefined();
        expect(result.applied.find((c) => c.code === 'EDGE_REFERENCE_DROPPED')).toBeTruthy();
    });

    it('synthesises group buckets when ≥5 nodes have no grouping', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'u', label: 'Cliente', kind: 'person' },
                { id: 'g', label: 'API Gateway', kind: 'gateway' },
                { id: 's1', label: 'Order Svc', kind: 'service' },
                { id: 's2', label: 'Billing Svc', kind: 'service' },
                { id: 'q', label: 'Order Topic', kind: 'messaging' },
                { id: 'd', label: 'Orders DB', kind: 'data' },
            ],
            edges: [
                { id: 'e1', source: 'u', target: 'g', label: 'Solicita' },
                { id: 'e2', source: 'g', target: 's1', label: 'Enruta' },
                { id: 'e3', source: 's1', target: 'q', label: 'Publica' },
                { id: 'e4', source: 'q', target: 's2', label: 'Suscribe' },
                { id: 'e5', source: 's2', target: 'd', label: 'Persiste' },
            ],
            groups: [],
        };
        const result = autoRepairDiagramIR(ir, { artifact: baseArtifact });
        expect(result.ir.groups.length).toBeGreaterThan(0);
        expect(result.applied.find((c) => c.code === 'GROUPING_SYNTHESIZED')).toBeTruthy();
    });


    it('splits dense existing groups to improve visual hierarchy', () => {
        const nodes = Array.from({ length: 14 }, (_, index) => ({
            id: `n${index + 1}`,
            label: `Paso ${index + 1}`,
            kind: index % 3 === 0 ? 'service' : 'process',
        }));
        const ir: DiagramIR = {
            nodes,
            edges: nodes.slice(0, -1).map((node, index) => ({
                id: `e${index + 1}`,
                source: node.id,
                target: nodes[index + 1].id,
                label: 'Continúa',
            })),
            groups: [{ id: 'mega', label: 'Proceso completo', nodeIds: nodes.map((node) => node.id) }],
        };
        const before = analyzeDiagramQuality(ir);
        const result = autoRepairDiagramIR(ir, { artifact: baseArtifact });
        const after = analyzeDiagramQuality(result.ir);

        expect(result.ir.groups.every((group) => group.nodeIds.length <= 8)).toBe(true);
        expect(after.breakdown.jerarquiaVisual).toBeGreaterThan(before.breakdown.jerarquiaVisual);
        expect(result.applied.find((change) => change.code === 'DENSE_GROUP_SPLIT')).toBeTruthy();
    });

    it('fills missing metadata (title, audience, theme, density, narrative)', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'svc', label: 'API', kind: 'service' },
                { id: 'db', label: 'DB', kind: 'data' },
            ],
            edges: [{ id: 'e1', source: 'svc', target: 'db', label: 'Consulta' }],
            groups: [],
        };
        const result = autoRepairDiagramIR(ir, { artifact: baseArtifact });
        const meta = result.ir.metadata!;
        expect(meta.title).toBe(baseArtifact.name);
        expect(meta.audience).toBe('technical');
        expect(meta.theme).toBeDefined();
        expect(meta.density).toBeDefined();
        expect(meta.narrative).toBeDefined();
        // The synthesis is a `DiagramNarrative` marked `derived`, not a bare
        // string: a topology description the repair composed must stay
        // distinguishable from a story somebody wrote, because the rubric and
        // the presentation walk both act on the difference.
        expect(typeof meta.narrative).toBe('object');
        expect(meta.narrative).toMatchObject({ source: 'derived' });
        expect(typeof (meta.narrative as { summary?: string }).summary).toBe('string');
    });

    it('records every change in repairHistory metadata', () => {
        const ir: DiagramIR = {
            nodes: [{ id: 'a', label: '', kind: '' }, { id: 'b', label: 'B', kind: 'service' }],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: '' }],
            groups: [],
        };
        const result = autoRepairDiagramIR(ir, { artifact: baseArtifact });
        expect(result.ir.metadata?.repairHistory?.length).toBeGreaterThan(0);
    });
});

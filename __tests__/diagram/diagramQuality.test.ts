import { describe, it, expect } from 'vitest';
import type { Edge, Node } from 'reactflow';
import { analyzeDiagramQuality, toDiagramIR } from '../../services/diagram/quality/diagramQualityService';

function makeNode(id: string, label: string, description?: string): Node {
    return {
        id,
        type: 'custom',
        position: { x: 0, y: 0 },
        data: { label, type: 'Service', description: description ?? '' },
    };
}

function makeEdge(id: string, source: string, target: string, label?: string): Edge {
    return { id, source, target, label: label ?? '' };
}

describe('diagramQualityService', () => {
    it('returns a high score for a well-formed diagram', () => {
        const nodes = [
            makeNode('a', 'User Gateway', 'Autentica peticiones externas'),
            makeNode('b', 'Order Service', 'Procesa órdenes de compra'),
            makeNode('c', 'Database', 'Persiste órdenes'),
        ];
        const edges = [
            makeEdge('e1', 'a', 'b', 'Request'),
            makeEdge('e2', 'b', 'c', 'Persist'),
        ];
        const ir = toDiagramIR(nodes, edges);
        const report = analyzeDiagramQuality(ir);
        expect(report.score).toBeGreaterThan(70);
        expect(report.issues.length).toBeLessThan(3);
    });

    it('penalises orphan nodes', () => {
        const nodes = [makeNode('a', 'Svc A'), makeNode('b', 'Svc B'), makeNode('c', 'Orphan')];
        const edges = [makeEdge('e1', 'a', 'b', 'Sync')];
        const ir = toDiagramIR(nodes, edges);
        const report = analyzeDiagramQuality(ir);
        expect(report.issues.some(i => i.code === 'ORPHAN_NODE')).toBe(true);
    });

    it('flags invalid edge references as critical', () => {
        const nodes = [makeNode('a', 'Svc A')];
        const edges = [makeEdge('e1', 'a', 'missing', 'Call')];
        const ir = toDiagramIR(nodes, edges);
        const report = analyzeDiagramQuality(ir);
        expect(report.issues.some(i => i.severity === 'critical')).toBe(true);
    });
});

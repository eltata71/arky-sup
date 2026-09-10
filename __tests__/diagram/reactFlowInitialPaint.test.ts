import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import { materializeNodesOnVisibleGrid, prepareEdgesForInitialPaint, prepareNodesForInitialPaint } from '../../components/reactFlowCanvas';

describe('ReactFlow initial paint safety net', () => {
    it('materializes incoming nodes immediately with labels and finite positions', () => {
        const nodes: Node[] = [
            { id: 'start', position: { x: Number.NaN, y: 0 }, data: { label: '' } },
            { id: 'pharmacy', position: { x: 120, y: 80 }, data: { label: 'Farmacia' } },
            { id: 'insurer', position: { x: Number.POSITIVE_INFINITY, y: Number.NEGATIVE_INFINITY }, data: {} },
        ];

        const prepared = prepareNodesForInitialPaint(nodes, 'standard');

        expect(prepared).toHaveLength(3);
        expect(prepared.every(node => node.type === 'custom')).toBe(true);
        expect(prepared[0].data.label).toBe('start');
        expect(prepared[1].data.label).toBe('Farmacia');
        expect(prepared[2].data.label).toBe('insurer');
        expect(prepared.every(node => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
        expect(prepared.every(node => node.data.density === 'standard')).toBe(true);
    });

    it('can force all content nodes back onto a visible grid after a blank DOM paint', () => {
        const nodes: Node[] = [
            { id: 'group', type: 'groupZone', position: { x: -10000, y: -10000 }, data: { label: 'Boundary' } },
            { id: 'offscreen-a', position: { x: 1_000_000, y: 1_000_000 }, data: { label: 'A' } },
            { id: 'offscreen-b', position: { x: -1_000_000, y: -1_000_000 }, data: {} },
        ];

        const recovered = materializeNodesOnVisibleGrid(nodes, 'compact');

        expect(recovered).toHaveLength(2);
        expect(recovered.map(node => node.id)).toEqual(['offscreen-a', 'offscreen-b']);
        expect(recovered[0].position).toEqual({ x: 0, y: 0 });
        expect(recovered[1].position.x).toBeGreaterThanOrEqual(0);
        expect(recovered.every(node => node.type === 'custom')).toBe(true);
        expect(recovered.every(node => node.data.density === 'compact')).toBe(true);
        expect(recovered[1].data.label).toBe('offscreen-b');
    });

    it('keeps only renderable edges and gives them deterministic defaults', () => {
        const nodeIds = new Set(['start', 'pharmacy']);
        const edges: Edge[] = [
            { id: '', source: 'start', target: 'pharmacy', data: {}, label: '' },
            { id: 'dangling', source: 'start', target: 'missing', data: {}, label: 'Ignorar' },
        ];

        const prepared = prepareEdgesForInitialPaint(edges, nodeIds);

        expect(prepared).toHaveLength(1);
        expect(prepared[0]).toMatchObject({
            id: 'edge-start-pharmacy',
            source: 'start',
            target: 'pharmacy',
            type: 'custom',
            label: 'Relaciona',
        });
        expect(prepared[0].markerEnd).toBeDefined();
    });
});

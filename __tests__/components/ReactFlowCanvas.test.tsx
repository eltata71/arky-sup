import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import { buildNarrativeScenes, prepareNodesForInitialPaint } from '../../components/reactFlowCanvas';

describe('ReactFlowCanvas defensive helpers', () => {
    it('builds bounded narrative scenes for cyclic generated graphs', () => {
        const nodes: Node[] = [
            { id: 'a', position: { x: 0, y: 0 }, data: { label: 'A' } },
            { id: 'b', position: { x: 0, y: 0 }, data: { label: 'B' } },
            { id: 'c', position: { x: 0, y: 0 }, data: { label: 'C' } },
        ];
        const edges: Edge[] = [
            { id: 'ab', source: 'a', target: 'b' },
            { id: 'bc', source: 'b', target: 'c' },
            { id: 'ca', source: 'c', target: 'a' },
        ];

        const scenes = buildNarrativeScenes(nodes, edges);

        expect(scenes.length).toBeGreaterThan(0);
        expect(scenes.length).toBeLessThanOrEqual(12);
        expect(scenes.at(-1)?.id).toBe('scene-overview');
        expect(scenes.at(-1)?.nodeIds).toEqual(new Set(['a', 'b', 'c']));
        expect(scenes.at(-1)?.edgeIds).toEqual(new Set(['ab', 'bc', 'ca']));
    });

    it('keeps disconnected cyclic islands visible in the narrative overview', () => {
        const nodes: Node[] = [
            { id: 'root', position: { x: 0, y: 0 }, data: { label: 'Root' } },
            { id: 'worker', position: { x: 0, y: 0 }, data: { label: 'Worker' } },
            { id: 'x', position: { x: 0, y: 0 }, data: { label: 'X' } },
            { id: 'y', position: { x: 0, y: 0 }, data: { label: 'Y' } },
        ];
        const edges: Edge[] = [
            { id: 'root-worker', source: 'root', target: 'worker' },
            { id: 'xy', source: 'x', target: 'y' },
            { id: 'yx', source: 'y', target: 'x' },
        ];

        const overview = buildNarrativeScenes(nodes, edges).at(-1);

        expect(overview?.nodeIds).toEqual(new Set(['root', 'worker', 'x', 'y']));
        expect(overview?.edgeIds).toEqual(new Set(['root-worker', 'xy', 'yx']));
    });

    it('replaces non-finite node positions before ReactFlow first paint', () => {
        const nodes: Node[] = [
            { id: 'broken', position: { x: Number.POSITIVE_INFINITY, y: Number.NaN }, data: { label: '' } },
        ];

        const [prepared] = prepareNodesForInitialPaint(nodes, 'standard');

        expect(Number.isFinite(prepared.position.x)).toBe(true);
        expect(Number.isFinite(prepared.position.y)).toBe(true);
        expect(prepared.data.label).toBe('broken');
    });
});

import { describe, it, expect } from 'vitest';
import { assignEdgeAnchors, pickSides, type AnchorEdge } from '../../services/diagram/edgeHandleAssignment';

type TestEdge = AnchorEdge & { id: string };

const node = (id: string, x: number, y: number, width = 260, height = 160) => ({
    id,
    position: { x, y },
    data: { width, height },
});

describe('pickSides', () => {
    it('routes horizontally when the horizontal distance dominates', () => {
        expect(pickSides({ x: 0, y: 0 }, { x: 500, y: 40 })).toEqual({ sourceSide: 'right', targetSide: 'left' });
        expect(pickSides({ x: 500, y: 0 }, { x: 0, y: 40 })).toEqual({ sourceSide: 'left', targetSide: 'right' });
    });

    it('routes vertically when the vertical distance dominates', () => {
        expect(pickSides({ x: 0, y: 0 }, { x: 40, y: 500 })).toEqual({ sourceSide: 'bottom', targetSide: 'top' });
        expect(pickSides({ x: 0, y: 500 }, { x: 40, y: 0 })).toEqual({ sourceSide: 'top', targetSide: 'bottom' });
    });
});

describe('assignEdgeAnchors', () => {
    it('gives each edge of a hub a different exit side (no starburst)', () => {
        const hub = node('hub', 1000, 1000);
        const nodes = [
            hub,
            node('right', 2000, 1000),
            node('left', 0, 1000),
            node('below', 1000, 2000),
            node('above', 1000, 0),
        ];
        const input: TestEdge[] = [
            { id: 'e1', source: 'hub', target: 'right' },
            { id: 'e2', source: 'hub', target: 'left' },
            { id: 'e3', source: 'hub', target: 'below' },
            { id: 'e4', source: 'hub', target: 'above' },
        ];
        const edges = assignEdgeAnchors(nodes, input);
        const handles = edges.map((e) => e.sourceHandle);
        expect(new Set(handles).size).toBe(4);
        expect(handles).toContain('s-right');
        expect(handles).toContain('s-left');
        expect(handles).toContain('s-bottom');
        expect(handles).toContain('s-top');
        // Targets mirror the source side.
        expect(edges[0].targetHandle).toBe('t-left');
        expect(edges[2].targetHandle).toBe('t-top');
    });

    it('leaves edges untouched when an endpoint has no finite position', () => {
        const nodes = [node('a', 0, 0), { id: 'b', position: { x: Number.NaN, y: 0 }, data: {} }];
        const edges: TestEdge[] = [{ id: 'e1', source: 'a', target: 'b' }];
        const result = assignEdgeAnchors(nodes, edges);
        expect(result[0].sourceHandle).toBeUndefined();
        expect(result).toBe(edges); // no mutation → same reference
    });

    it('recomputes stale handles when geometry changes (post-drag)', () => {
        const nodes = [node('a', 0, 0), node('b', 800, 0)];
        const edges = [{ id: 'e1', source: 'a', target: 'b', sourceHandle: 's-bottom', targetHandle: 't-top' }];
        const result = assignEdgeAnchors(nodes, edges);
        expect(result[0].sourceHandle).toBe('s-right');
        expect(result[0].targetHandle).toBe('t-left');
    });

    it('ignores group zone pseudo-nodes', () => {
        const nodes = [
            node('a', 0, 0),
            node('b', 800, 0),
            { ...node('__group__X', 0, 0, 2000, 2000), type: 'groupZone' },
        ];
        const flat: TestEdge[] = [{ id: 'e1', source: 'a', target: 'b' }];
        const result = assignEdgeAnchors(nodes, flat);
        expect(result[0].sourceHandle).toBe('s-right');
    });
});

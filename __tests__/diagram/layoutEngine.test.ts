import { describe, it, expect } from 'vitest';
import { layoutIR, inferDirection, edgeWaypointKey } from '../../lib/layoutEngine';
import { LAYOUT_PRESETS } from '../../lib/diagramTokens';
import type { DiagramIR } from '../../lib/diagram';

function buildIR(partial: Partial<DiagramIR> = {}): DiagramIR {
    return {
        nodes: partial.nodes ?? [],
        edges: partial.edges ?? [],
        groups: partial.groups ?? [],
        metadata: partial.metadata,
    };
}

describe('layoutEngine.inferDirection', () => {
    it('prefers LR when sequence verbs appear in edge labels', () => {
        const ir = buildIR({
            nodes: [
                { id: 'a', label: 'Cliente', kind: 'service' },
                { id: 'b', label: 'API', kind: 'service' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'envia request' }],
        });
        expect(inferDirection(ir)).toBe('LR');
    });

    it('prefers TB when there are 3+ groups (deep hierarchy)', () => {
        const ir = buildIR({
            nodes: Array.from({ length: 6 }).map((_, i) => ({ id: `n${i}`, label: `n${i}`, kind: 'service' })),
            edges: [],
            groups: [
                { id: 'g1', label: 'A', nodeIds: ['n0', 'n1'] },
                { id: 'g2', label: 'B', nodeIds: ['n2', 'n3'] },
                { id: 'g3', label: 'C', nodeIds: ['n4', 'n5'] },
            ],
        });
        expect(inferDirection(ir)).toBe('TB');
    });
});

describe('layoutEngine.layoutIR', () => {
    const ir = buildIR({
        nodes: [
            { id: 'user', label: 'Cliente', kind: 'person' },
            { id: 'api',  label: 'API',     kind: 'gateway' },
            { id: 'db',   label: 'DB',      kind: 'data' },
        ],
        edges: [
            { id: 'e1', source: 'user', target: 'api', label: 'Solicita', relation: 'sync' },
            { id: 'e2', source: 'api',  target: 'db',  label: 'Consulta', relation: 'sync' },
        ],
    });

    it('returns positions for every IR node sized per the requested preset', () => {
        const result = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        expect(result.positions.size).toBe(3);
        const pos = result.positions.get('user')!;
        expect(pos.width).toBe(LAYOUT_PRESETS.flow.node.width);
        expect(pos.height).toBe(LAYOUT_PRESETS.flow.node.height);
    });

    it('produces top-left coordinates so callers do not need to recentre', () => {
        const result = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        for (const pos of result.positions.values()) {
            expect(Number.isFinite(pos.x)).toBe(true);
            expect(Number.isFinite(pos.y)).toBe(true);
        }
    });

    it('captures dagre per-edge waypoints under the canonical key', () => {
        const result = layoutIR(ir, { preset: 'excalidraw', direction: 'TB' });
        const key = edgeWaypointKey('user', 'api', 'e1');
        const points = result.edgeWaypoints.get(key);
        expect(points).toBeDefined();
        expect(points!.length).toBeGreaterThan(0);
    });

    it('density `compact` shrinks rank/node separation versus `spacious`', () => {
        const compactBBox = layoutIR(ir, { preset: 'flow', direction: 'TB', density: 'compact' }).bbox;
        const spaciousBBox = layoutIR(ir, { preset: 'flow', direction: 'TB', density: 'spacious' }).bbox;
        expect(spaciousBBox.height).toBeGreaterThan(compactBBox.height);
    });

    it('returns a finite, non-zero bbox covering every node', () => {
        const result = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        expect(result.bbox.width).toBeGreaterThan(0);
        expect(result.bbox.height).toBeGreaterThan(0);
    });

    it('positions every node in a large diagram (>14 nodes)', () => {
        const big = buildIR({
            nodes: Array.from({ length: 24 }).map((_, i) => ({
                id: `n${i}`, label: `Node ${i}`, kind: 'service',
            })),
            edges: Array.from({ length: 23 }).map((_, i) => ({
                id: `e${i}`, source: `n${i}`, target: `n${i + 1}`, label: '',
            })),
        });
        const result = layoutIR(big, { preset: 'flow', direction: 'LR' });
        expect(result.positions.size).toBe(24);
        for (const pos of result.positions.values()) {
            expect(Number.isFinite(pos.x)).toBe(true);
            expect(Number.isFinite(pos.y)).toBe(true);
        }
    });
});

describe('layoutEngine.layoutIR — cluster-aware layout', () => {
    const grouped = buildIR({
        nodes: [
            { id: 'a1', label: 'A1', kind: 'service', group: 'Alpha' },
            { id: 'a2', label: 'A2', kind: 'service', group: 'Alpha' },
            { id: 'a3', label: 'A3', kind: 'service', group: 'Alpha' },
            { id: 'b1', label: 'B1', kind: 'service', group: 'Beta' },
            { id: 'b2', label: 'B2', kind: 'service', group: 'Beta' },
            { id: 'b3', label: 'B3', kind: 'service', group: 'Beta' },
        ],
        edges: [
            { id: 'e1', source: 'a1', target: 'a2', label: '' },
            { id: 'e2', source: 'a2', target: 'a3', label: '' },
            { id: 'e3', source: 'b1', target: 'b2', label: '' },
            { id: 'e4', source: 'b2', target: 'b3', label: '' },
            { id: 'e5', source: 'a3', target: 'b1', label: '' },
        ],
    });

    function groupBox(result: ReturnType<typeof layoutIR>, group: string) {
        const members = grouped.nodes
            .filter((n) => n.group === group)
            .map((n) => result.positions.get(n.id)!);
        return {
            minX: Math.min(...members.map((p) => p.x)),
            maxX: Math.max(...members.map((p) => p.x + p.width)),
            minY: Math.min(...members.map((p) => p.y)),
            maxY: Math.max(...members.map((p) => p.y + p.height)),
        };
    }

    it('positions every node when laying out a multi-group diagram', () => {
        const result = layoutIR(grouped, { preset: 'flow', direction: 'TB' });
        expect(result.positions.size).toBe(6);
    });

    it('keeps the two groups in non-overlapping regions', () => {
        const result = layoutIR(grouped, { preset: 'flow', direction: 'TB' });
        const a = groupBox(result, 'Alpha');
        const b = groupBox(result, 'Beta');
        const disjoint =
            a.maxX <= b.minX || b.maxX <= a.minX ||
            a.maxY <= b.minY || b.maxY <= a.minY;
        expect(disjoint).toBe(true);
    });

    it('still routes cross-group edges as waypoints', () => {
        const result = layoutIR(grouped, { preset: 'flow', direction: 'TB' });
        const points = result.edgeWaypoints.get(edgeWaypointKey('a3', 'b1', 'e5'));
        expect(points).toBeDefined();
        expect(points!.length).toBeGreaterThan(0);
    });
});

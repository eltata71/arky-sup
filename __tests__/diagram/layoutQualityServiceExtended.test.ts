import { describe, it, expect } from 'vitest';
import {
    computeLayoutQuality,
    layoutMetricsToLints,
    nodesToRects,
    type NodeRect,
} from '../../services/diagram/layoutQualityService';
import type { DiagramIR } from '../../lib/diagram';

const baseIR = (): DiagramIR => ({
    nodes: [
        { id: 'a', label: 'Alpha', kind: 'service' },
        { id: 'b', label: 'Beta', kind: 'service', group: 'Domain' },
        { id: 'c', label: 'Gamma', kind: 'service', group: 'Domain' },
    ],
    edges: [
        { id: 'e1', source: 'a', target: 'b', label: 'invoca' },
        { id: 'e2', source: 'a', target: 'c', label: 'consulta' },
    ],
    groups: [{ id: 'g1', label: 'Domain', nodeIds: ['b', 'c'] }],
});

describe('layoutQualityService — extended visual lints (Gap 5)', () => {
    it('detects two group zones that overlap', () => {
        const ir = baseIR();
        const nodeRects: NodeRect[] = [
            { id: 'a', x: 0, y: 0, width: 100, height: 60 },
            { id: 'b', x: 200, y: 0, width: 100, height: 60 },
            { id: 'c', x: 220, y: 80, width: 100, height: 60 },
        ];
        const metrics = computeLayoutQuality({
            ir,
            nodeRects,
            groupRects: [
                { id: 'g1', label: 'Domain', x: 180, y: -10, width: 160, height: 200 },
                { id: 'g2', label: 'Other', x: 200, y: -10, width: 140, height: 80 },
            ],
        });
        expect(metrics.overlappingGroupPairs.length).toBe(1);
        const lints = layoutMetricsToLints(metrics);
        expect(lints.some((l) => l.code === 'VISUAL_GROUP_OVERLAP')).toBe(true);
    });

    it('detects nodes that escape their declared boundary', () => {
        const ir = baseIR();
        const nodeRects: NodeRect[] = [
            { id: 'a', x: 0, y: 0, width: 100, height: 60 },
            { id: 'b', x: 200, y: 0, width: 100, height: 60 },
            { id: 'c', x: 600, y: 600, width: 100, height: 60 }, // escaped from "Domain"
        ];
        const metrics = computeLayoutQuality({
            ir,
            nodeRects,
            groupRects: [{ id: 'g1', label: 'Domain', x: 180, y: -10, width: 160, height: 100, memberIds: ['b', 'c'] }],
        });
        expect(metrics.boundaryContainmentBreaches.length).toBe(1);
        expect(metrics.boundaryContainmentBreaches[0].nodeIds).toContain('c');
        const lints = layoutMetricsToLints(metrics);
        expect(lints.some((l) => l.code === 'VISUAL_BOUNDARY_BREACH')).toBe(true);
    });

    it('detects nodes outside the supplied viewport', () => {
        const ir = baseIR();
        const nodeRects: NodeRect[] = [
            { id: 'a', x: 0, y: 0, width: 100, height: 60 },
            { id: 'b', x: 200, y: 0, width: 100, height: 60 },
            { id: 'c', x: 5000, y: 5000, width: 100, height: 60 },
        ];
        const metrics = computeLayoutQuality({
            ir,
            nodeRects,
            viewport: { x: 0, y: 0, width: 1024, height: 768 },
        });
        expect(metrics.nodesOutsideViewport).toContain('c');
        const lints = layoutMetricsToLints(metrics);
        expect(lints.some((l) => l.code === 'VISUAL_OFFSCREEN_NODES')).toBe(true);
    });

    it('flags edges that pass through unrelated nodes', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'A', kind: 'service' },
                { id: 'b', label: 'B', kind: 'service' },
                { id: 'c', label: 'In the way', kind: 'service' },
            ],
            edges: [{ id: 'a-b', source: 'a', target: 'b', label: 'thru' }],
            groups: [],
        };
        const nodeRects: NodeRect[] = [
            { id: 'a', x: 0, y: 50, width: 80, height: 40 },
            { id: 'b', x: 400, y: 50, width: 80, height: 40 },
            { id: 'c', x: 200, y: 40, width: 80, height: 60 },
        ];
        const metrics = computeLayoutQuality({ ir, nodeRects });
        expect(metrics.edgesCrossingNodes.length).toBeGreaterThan(0);
        const lints = layoutMetricsToLints(metrics);
        expect(lints.some((l) => l.code === 'VISUAL_EDGES_THROUGH_NODES')).toBe(true);
    });

    it('flags nodes obscured by floating obstacles (toolbars/panels)', () => {
        const ir = baseIR();
        const nodeRects: NodeRect[] = [
            { id: 'a', x: 0, y: 0, width: 100, height: 60 },
            { id: 'b', x: 200, y: 0, width: 100, height: 60 },
            { id: 'c', x: 400, y: 0, width: 100, height: 60 },
        ];
        const metrics = computeLayoutQuality({
            ir,
            nodeRects,
            floatingObstacles: [{ x: 190, y: -20, width: 120, height: 200, label: 'Inspector' }],
        });
        expect(metrics.nodesObscuredByObstacles.some((o) => o.nodeId === 'b')).toBe(true);
        const lints = layoutMetricsToLints(metrics);
        expect(lints.some((l) => l.code === 'VISUAL_OBSCURED_BY_PANELS')).toBe(true);
    });

    it('respects waypoints for crossing detection when provided', () => {
        const ir: DiagramIR = {
            nodes: [
                { id: 'a', label: 'A', kind: 'service' },
                { id: 'b', label: 'B', kind: 'service' },
            ],
            edges: [{ id: 'e', source: 'a', target: 'b', label: 'rel' }],
            groups: [],
        };
        const nodeRects: NodeRect[] = [
            { id: 'a', x: 0, y: 0, width: 80, height: 40 },
            { id: 'b', x: 400, y: 0, width: 80, height: 40 },
        ];
        const metrics = computeLayoutQuality({
            ir,
            nodeRects,
            edgeSegments: [{
                id: 'e',
                source: 'a',
                target: 'b',
                waypoints: [
                    { x: 40, y: 20 },
                    { x: 200, y: 300 },
                    { x: 440, y: 20 },
                ],
            }],
        });
        expect(metrics.hasLayout).toBe(true);
    });

    it('nodesToRects ignores entries without finite positions', () => {
        const rects = nodesToRects([
            { id: 'a', position: { x: 0, y: 0 } },
            { id: 'b', position: { x: Number.NaN, y: 0 } },
            { id: 'c' },
        ]);
        expect(rects.map((r) => r.id)).toEqual(['a']);
    });
});

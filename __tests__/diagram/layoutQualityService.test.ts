import { describe, it, expect } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import {
    computeLayoutQuality,
    computeExportBounds,
    layoutMetricsToLints,
    nodesToRects,
    type NodeRect,
} from '../../services/diagram/layoutQualityService';

const ir: DiagramIR = {
    nodes: [
        { id: 'a', label: 'A', kind: 'system' },
        { id: 'b', label: 'B', kind: 'system' },
        { id: 'c', label: 'C', kind: 'system' },
    ],
    edges: [
        { id: 'e1', source: 'a', target: 'b', label: 'do', relation: 'sync' },
        { id: 'e2', source: 'b', target: 'c', label: 'do', relation: 'sync' },
    ],
    groups: [],
};

describe('Phase 2 — layoutQualityService', () => {
    it('returns empty metrics when no positions are supplied', () => {
        const metrics = computeLayoutQuality({ ir, nodeRects: [] });
        expect(metrics.hasLayout).toBe(false);
        expect(metrics.nodeCount).toBe(0);
    });

    it('computes a sane bounding box and aspect ratio for a horizontal strip', () => {
        const rects: NodeRect[] = [
            { id: 'a', x: 0,    y: 0, width: 200, height: 100 },
            { id: 'b', x: 400,  y: 0, width: 200, height: 100 },
            { id: 'c', x: 800,  y: 0, width: 200, height: 100 },
        ];
        const metrics = computeLayoutQuality({ ir, nodeRects: rects });
        expect(metrics.hasLayout).toBe(true);
        expect(metrics.nodeCount).toBe(3);
        expect(metrics.boundingBox.width).toBe(1000);
        expect(metrics.boundingBox.height).toBe(100);
        expect(metrics.aspectStrip).toBe('horizontal');
        expect(metrics.aspectRatio).toBeGreaterThanOrEqual(10);
    });

    it('detects overlapping nodes', () => {
        const rects: NodeRect[] = [
            { id: 'a', x: 0,  y: 0, width: 200, height: 100 },
            { id: 'b', x: 50, y: 0, width: 200, height: 100 }, // overlaps with a
        ];
        const metrics = computeLayoutQuality({ ir, nodeRects: rects });
        expect(metrics.overlappingNodePairs).toHaveLength(1);
        expect(metrics.overlappingNodePairs[0]).toEqual({ a: 'a', b: 'b' });
    });

    it('flags export crop risk when nodes touch the bounding box edge', () => {
        const rects: NodeRect[] = [
            { id: 'a', x: 0,   y: 0, width: 100, height: 100 },
            { id: 'b', x: 200, y: 200, width: 100, height: 100 },
        ];
        const metrics = computeLayoutQuality({ ir, nodeRects: rects });
        expect(metrics.exportCropRisk).not.toBe('none');
    });

    it('layoutMetricsToLints surfaces the visual issues with the right ids', () => {
        const rects: NodeRect[] = [
            { id: 'a', x: 0,    y: 0, width: 200, height: 100 },
            { id: 'b', x: 50,   y: 0, width: 200, height: 100 }, // overlap
            { id: 'c', x: 1000, y: 0, width: 200, height: 100 },
        ];
        const metrics = computeLayoutQuality({ ir, nodeRects: rects });
        const lints = layoutMetricsToLints(metrics);
        const ids = new Set(lints.map((l) => l.id));
        expect(ids.has('layout-node-overlap')).toBe(true);
        // aspect strip should appear because horizontal extent is > 3x height
        expect(ids.has('layout-aspect-strip')).toBe(true);
    });

    it('computeExportBounds adds padding around the content bbox', () => {
        const rects: NodeRect[] = [
            { id: 'a', x: 100, y: 100, width: 200, height: 100 },
        ];
        const bounds = computeExportBounds(rects, 48);
        expect(bounds.x).toBe(52);
        expect(bounds.y).toBe(52);
        expect(bounds.width).toBe(200 + 96);
        expect(bounds.height).toBe(100 + 96);
    });

    it('nodesToRects ignores nodes with invalid positions', () => {
        const rects = nodesToRects([
            { id: 'a', position: { x: 10, y: 20 } },
            { id: 'b', position: { x: Number.NaN, y: 0 } },
            { id: 'c', position: undefined },
            { id: 'd', position: { x: 30, y: 40 }, width: 250, height: 150 },
        ]);
        expect(rects.map((r) => r.id)).toEqual(['a', 'd']);
        expect(rects[1].width).toBe(250);
        expect(rects[1].height).toBe(150);
    });
});

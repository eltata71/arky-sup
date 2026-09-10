import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import {
    computeContentBBox,
    computeFitZoom,
    computeSmartFitViewport,
} from '../../services/diagram/smartFit';

const nodeAt = (id: string, x: number, y: number, w = 260, h = 160): Node => ({
    id,
    position: { x, y },
    width: w,
    height: h,
    data: { label: id },
});

const OPTS = {
    paddingFraction: 0.1,
    minZoom:         0.45,
    maxZoom:         1.35,
    duration:        0,
    bottomReserve:   96,
    topReserve:      16,
};

describe('computeContentBBox', () => {
    it('returns null when there are no content nodes', () => {
        expect(computeContentBBox([])).toBeNull();
    });

    it('ignores group-zone decoration nodes', () => {
        const nodes: Node[] = [
            { id: 'g', type: 'groupZone', position: { x: -1000, y: -1000 }, data: { label: '' } },
            nodeAt('a', 0, 0),
            nodeAt('b', 400, 200),
        ];
        const bbox = computeContentBBox(nodes);
        expect(bbox).not.toBeNull();
        expect(bbox!.minX).toBe(0);
        expect(bbox!.minY).toBe(0);
        // Maxes use the canonical 260×160 node size from LAYOUT_PRESETS.flow.
        expect(bbox!.maxX).toBe(660);
        expect(bbox!.maxY).toBe(360);
        expect(bbox!.centerX).toBe(330);
        expect(bbox!.centerY).toBe(180);
    });

    it('skips nodes with non-finite positions', () => {
        const nodes: Node[] = [
            { id: 'a', position: { x: NaN, y: NaN }, data: { label: 'a' } },
            nodeAt('b', 100, 100),
        ];
        const bbox = computeContentBBox(nodes);
        expect(bbox).not.toBeNull();
        expect(bbox!.minX).toBe(100);
    });
});

describe('computeFitZoom', () => {
    const bbox = { minX: 0, minY: 0, maxX: 1000, maxY: 600, width: 1000, height: 600, centerX: 500, centerY: 300 };

    it('clamps to minZoom for sparse vertical strips on wide viewports', () => {
        // A 200 × 2000 strip on a 1200 × 800 iPad-ish viewport would
        // naively zoom to 800/2000 = 0.4. Smart-fit clamps to minZoom.
        const strip = { ...bbox, maxX: 200, maxY: 2000, width: 200, height: 2000, centerX: 100, centerY: 1000 };
        const z = computeFitZoom(strip, 1200, 800, OPTS);
        expect(z).toBeGreaterThanOrEqual(OPTS.minZoom);
        expect(z).toBeLessThanOrEqual(OPTS.maxZoom);
    });

    it('clamps to maxZoom for tiny diagrams that would otherwise zoom to 200%', () => {
        const tiny = { ...bbox, maxX: 100, maxY: 100, width: 100, height: 100, centerX: 50, centerY: 50 };
        const z = computeFitZoom(tiny, 1200, 800, OPTS);
        expect(z).toBe(OPTS.maxZoom);
    });

    it('returns a comfortable zoom for mid-size diagrams', () => {
        const z = computeFitZoom(bbox, 1200, 800, OPTS);
        expect(z).toBeGreaterThan(OPTS.minZoom);
        expect(z).toBeLessThanOrEqual(OPTS.maxZoom);
    });
});

describe('computeSmartFitViewport', () => {
    it('reserves space for the bottom toolbar by biasing the visible center upward', () => {
        const bbox = { minX: 0, minY: 0, maxX: 500, maxY: 300, width: 500, height: 300, centerX: 250, centerY: 150 };
        // With default reserves the visible centre is biased upward; with
        // no reserves it sits at the geometric centre of the viewport. Since
        // y in ReactFlow's viewport translates content downward, a smaller
        // `y` corresponds to content moved up — exactly what the toolbar
        // requires for the bbox to sit above it.
        const vpReserved = computeSmartFitViewport(bbox, 1000, 700);
        const vpUnreserved = computeSmartFitViewport(bbox, 1000, 700, { topReserve: 0, bottomReserve: 0 });
        expect(vpReserved.zoom).toBeCloseTo(vpUnreserved.zoom, 4);
        expect(vpReserved.y).toBeLessThan(vpUnreserved.y);
    });

    it('produces finite viewport coordinates', () => {
        const bbox = { minX: 0, minY: 0, maxX: 600, maxY: 400, width: 600, height: 400, centerX: 300, centerY: 200 };
        const vp = computeSmartFitViewport(bbox, 1200, 800);
        expect(Number.isFinite(vp.x)).toBe(true);
        expect(Number.isFinite(vp.y)).toBe(true);
        expect(Number.isFinite(vp.zoom)).toBe(true);
    });
});

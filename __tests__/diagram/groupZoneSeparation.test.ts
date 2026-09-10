import { describe, it, expect } from 'vitest';
import {
    computeGroupSeparationOffsets,
    separateGroupClusters,
    type SeparationNode,
} from '../../services/diagram/groupZoneSeparation';

const node = (id: string, group: string | undefined, x: number, y: number): SeparationNode => ({
    id,
    group,
    x,
    y,
    width: 260,
    height: 160,
});

function clusterRect(nodes: SeparationNode[], group: string, padding = 44) {
    const members = nodes.filter((n) => n.group === group);
    return {
        minX: Math.min(...members.map((n) => n.x)) - padding,
        minY: Math.min(...members.map((n) => n.y)) - padding,
        maxX: Math.max(...members.map((n) => n.x + n.width)) + padding,
        maxY: Math.max(...members.map((n) => n.y + n.height)) + padding,
    };
}

function rectsOverlap(a: ReturnType<typeof clusterRect>, b: ReturnType<typeof clusterRect>): boolean {
    return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

describe('groupZoneSeparation', () => {
    it('returns no offsets when zones already have clearance', () => {
        const nodes = [
            node('a1', 'A', 0, 0),
            node('a2', 'A', 0, 220),
            node('b1', 'B', 1200, 0),
        ];
        expect(computeGroupSeparationOffsets(nodes).size).toBe(0);
        // No-op keeps the same array reference so React reconciliation is cheap.
        expect(separateGroupClusters(nodes)).toBe(nodes);
    });

    it('separates two overlapping clusters until their zones no longer intersect', () => {
        const nodes = [
            node('a1', 'A', 0, 0),
            node('a2', 'A', 300, 0),
            // Group B lands on top of group A — the overlapping-zone bug.
            node('b1', 'B', 150, 40),
            node('b2', 'B', 450, 40),
        ];
        const separated = separateGroupClusters(nodes);
        const a = clusterRect(separated, 'A');
        const b = clusterRect(separated, 'B');
        expect(rectsOverlap(a, b)).toBe(false);
    });

    it('preserves the internal geometry of each cluster (rigid translation)', () => {
        const nodes = [
            node('a1', 'A', 0, 0),
            node('a2', 'A', 300, 120),
            node('b1', 'B', 100, 60),
        ];
        const separated = separateGroupClusters(nodes);
        const a1 = separated.find((n) => n.id === 'a1')!;
        const a2 = separated.find((n) => n.id === 'a2')!;
        expect(a2.x - a1.x).toBe(300);
        expect(a2.y - a1.y).toBe(120);
    });

    it('never moves ungrouped nodes', () => {
        const nodes = [
            node('a1', 'A', 0, 0),
            node('b1', 'B', 60, 30),
            node('free', undefined, 30, 10),
        ];
        const separated = separateGroupClusters(nodes);
        const free = separated.find((n) => n.id === 'free')!;
        expect(free.x).toBe(30);
        expect(free.y).toBe(10);
    });

    it('resolves three-way pile-ups deterministically', () => {
        const nodes = [
            node('a1', 'A', 0, 0),
            node('b1', 'B', 40, 20),
            node('c1', 'C', 80, 40),
        ];
        const first = separateGroupClusters(nodes);
        const second = separateGroupClusters(nodes);
        expect(first).toEqual(second);
        const rects = ['A', 'B', 'C'].map((g) => clusterRect(first, g));
        expect(rectsOverlap(rects[0], rects[1])).toBe(false);
        expect(rectsOverlap(rects[1], rects[2])).toBe(false);
        expect(rectsOverlap(rects[0], rects[2])).toBe(false);
    });
});

import { describe, it, expect } from 'vitest';
import { layoutIR } from '../../lib/layoutEngine';
import { irToReactFlowSmart } from '../../services/diagram/irToReactFlow';
import type { DiagramIR, DiagramIRNode } from '../../lib/diagram';

const node = (id: string, group?: string): DiagramIRNode => ({
    id,
    label: `Nodo ${id}`,
    kind: 'service',
    group,
});

/** IR shaped like the field screenshots: several groups + free nodes + cross edges. */
const buildGroupedIR = (): DiagramIR => ({
    nodes: [
        node('a1', 'Canales'), node('a2', 'Canales'), node('a3', 'Canales'),
        node('b1', 'Core PBM'), node('b2', 'Core PBM'), node('b3', 'Core PBM'), node('b4', 'Core PBM'),
        node('c1', 'Datos'), node('c2', 'Datos'),
        node('x1'), node('x2'),
    ],
    edges: [
        { id: 'e1', source: 'a1', target: 'a2', label: 'Invoca' },
        { id: 'e2', source: 'a2', target: 'b1', label: 'Solicita' },
        { id: 'e3', source: 'b1', target: 'b2', label: 'Orquesta' },
        { id: 'e4', source: 'b2', target: 'b3', label: 'Valida' },
        { id: 'e5', source: 'b3', target: 'c1', label: 'Persiste' },
        { id: 'e6', source: 'c1', target: 'c2', label: 'Replica' },
        { id: 'e7', source: 'x1', target: 'b1', label: 'Notifica' },
        { id: 'e8', source: 'b4', target: 'x2', label: 'Publica' },
        { id: 'e9', source: 'a3', target: 'c2', label: 'Consulta' },
    ],
    groups: [
        { id: 'g1', label: 'Canales', nodeIds: ['a1', 'a2', 'a3'] },
        { id: 'g2', label: 'Core PBM', nodeIds: ['b1', 'b2', 'b3', 'b4'] },
        { id: 'g3', label: 'Datos', nodeIds: ['c1', 'c2'] },
    ],
});

interface Box { minX: number; minY: number; maxX: number; maxY: number }

const boxOf = (positions: Map<string, { x: number; y: number; width: number; height: number }>, ids: string[]): Box => {
    const members = ids.map((id) => positions.get(id)!);
    return {
        minX: Math.min(...members.map((p) => p.x)),
        minY: Math.min(...members.map((p) => p.y)),
        maxX: Math.max(...members.map((p) => p.x + p.width)),
        maxY: Math.max(...members.map((p) => p.y + p.height)),
    };
};

const overlap = (a: Box, b: Box): boolean =>
    a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

describe('layoutIR — two-level grouped layout', () => {
    const ir = buildGroupedIR();
    const groupIds: Record<string, string[]> = {
        Canales: ['a1', 'a2', 'a3'],
        'Core PBM': ['b1', 'b2', 'b3', 'b4'],
        Datos: ['c1', 'c2'],
    };

    it('positions every node, grouped and ungrouped', () => {
        const result = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        expect(result.positions.size).toBe(ir.nodes.length);
    });

    it('keeps every pair of group footprints disjoint', () => {
        const result = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        const boxes = Object.values(groupIds).map((ids) => boxOf(result.positions, ids));
        for (let i = 0; i < boxes.length; i++) {
            for (let j = i + 1; j < boxes.length; j++) {
                expect(overlap(boxes[i], boxes[j])).toBe(false);
            }
        }
    });

    it('keeps group footprints content-sized (no giant sparse zones)', () => {
        const result = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        for (const ids of Object.values(groupIds)) {
            const box = boxOf(result.positions, ids);
            const zoneArea = (box.maxX - box.minX) * (box.maxY - box.minY);
            const contentArea = ids.reduce((acc, id) => {
                const p = result.positions.get(id)!;
                return acc + p.width * p.height;
            }, 0);
            // A contiguous internal layout never exceeds ~12x the node area
            // (spacing included); the scattered-members bug produced 50-100x.
            expect(zoneArea / contentArea).toBeLessThan(12);
        }
    });

    it('keeps ungrouped nodes out of every group footprint', () => {
        const result = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        const boxes = Object.values(groupIds).map((ids) => boxOf(result.positions, ids));
        for (const freeId of ['x1', 'x2']) {
            const p = result.positions.get(freeId)!;
            const free: Box = { minX: p.x, minY: p.y, maxX: p.x + p.width, maxY: p.y + p.height };
            for (const box of boxes) {
                expect(overlap(free, box)).toBe(false);
            }
        }
    });

    it('emits waypoints for every edge (intra-group and cross-group)', () => {
        const result = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        for (const edge of ir.edges) {
            const key = `${edge.source}::${edge.target}::${edge.id}`;
            const points = result.edgeWaypoints.get(key);
            expect(points, `waypoints de ${edge.id}`).toBeDefined();
            expect(points!.length).toBeGreaterThan(0);
        }
    });

    it('is deterministic across runs', () => {
        const a = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        const b = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        for (const [id, pos] of a.positions) {
            expect(b.positions.get(id)).toEqual(pos);
        }
    });
});

describe('irToReactFlowSmart — grouped diagrams bypass ELK', () => {
    it('uses the grouped dagre layout and reports it in the plan', async () => {
        const result = await irToReactFlowSmart(buildGroupedIR(), 'mermaid-graph');
        expect(result.plan.backend).toBe('dagre');
        expect(result.plan.rationale).toContain('agrupaciones');
        // Groups stay disjoint after materialization too.
        const byId = new Map(result.nodes.map((n) => [String(n.id), n] as const));
        const box = (ids: string[]): Box => {
            const members = ids.map((id) => byId.get(id)!);
            return {
                minX: Math.min(...members.map((n) => n.position.x)),
                minY: Math.min(...members.map((n) => n.position.y)),
                maxX: Math.max(...members.map((n) => n.position.x + ((n.data as { width?: number }).width ?? 260))),
                maxY: Math.max(...members.map((n) => n.position.y + ((n.data as { height?: number }).height ?? 160))),
            };
        };
        expect(overlap(box(['a1', 'a2', 'a3']), box(['b1', 'b2', 'b3', 'b4']))).toBe(false);
    });

    it('assigns geometric edge anchors on the canonical pipeline', async () => {
        const result = await irToReactFlowSmart(buildGroupedIR(), 'mermaid-graph');
        const withHandles = result.edges.filter((e) => e.sourceHandle && e.targetHandle);
        expect(withHandles.length).toBe(result.edges.length);
        for (const edge of withHandles) {
            expect(edge.sourceHandle).toMatch(/^s-(top|bottom|left|right)$/);
            expect(edge.targetHandle).toMatch(/^t-(top|bottom|left|right)$/);
        }
    });
});

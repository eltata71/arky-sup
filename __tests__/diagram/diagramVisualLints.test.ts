import { describe, expect, it } from 'vitest';
import type { DiagramIR } from '../../lib/diagram';
import {
    collectVisualLints,
    lintDensity,
    lintEdgeLabelCollisions,
    lintIntegrationLayering,
    lintLabelOverflow,
    lintProcessTerminus,
    lintSparseLayout,
    lintValueStreamOrientation,
    pseudoLayoutForLints,
} from '../../services/diagram/diagramVisualLints';

const node = (id: string, label = id, extra: Partial<DiagramIR['nodes'][number]> = {}) => ({
    id,
    label,
    kind: 'system',
    ...extra,
});

const ir = (overrides: Partial<DiagramIR> = {}): DiagramIR => ({
    nodes: [], edges: [], groups: [], ...overrides,
});

describe('lintSparseLayout', () => {
    it('does not fire for small diagrams', () => {
        const diagram = ir({ nodes: [node('a'), node('b')] });
        expect(lintSparseLayout(diagram)).toEqual([]);
    });

    it('fires when the pseudo-layout produces a strip with >= 3:1 ratio', () => {
        // 9 nodes laid out 1 wide × 9 tall would give a vertical strip.
        // pseudoLayoutForLints uses sqrt(n) cols so we need to override.
        const nodes = Array.from({ length: 16 }, (_, i) => node(`n${i}`));
        const positions = nodes.map((n, i) => ({
            id: n.id,
            x: 0,
            y: i * 220,
            width: 260,
            height: 160,
        }));
        const result = lintSparseLayout(ir({ nodes }), positions);
        expect(result).toHaveLength(1);
        expect(result[0].code).toBe('VISUAL_SPARSE_LAYOUT');
        expect(result[0].message).toMatch(/vertical/);
    });

    it('does not fire for square-ish diagrams', () => {
        const nodes = Array.from({ length: 9 }, (_, i) => node(`n${i}`));
        // pseudoLayoutForLints gives a 3×3 grid for 9 nodes.
        expect(lintSparseLayout(ir({ nodes }))).toEqual([]);
    });
});

describe('lintLabelOverflow', () => {
    it('detects multi-word long labels that will likely overflow', () => {
        const diagram = ir({
            nodes: [
                node('a', 'Servicio de Adjudicación de Reclamos Farmacéuticos Pre-Autorización'),
                node('b', 'CortoOK'),
            ],
        });
        const result = lintLabelOverflow(diagram);
        expect(result).toHaveLength(1);
        expect(result[0].affectedIds).toEqual(['a']);
    });

    it('does not fire for short labels', () => {
        const diagram = ir({ nodes: [node('a', 'API'), node('b', 'DB Reclamos')] });
        expect(lintLabelOverflow(diagram)).toEqual([]);
    });
});

describe('lintEdgeLabelCollisions', () => {
    it('fires when two labeled edges share endpoints', () => {
        const nodes = [node('a'), node('b'), node('c')];
        const diagram = ir({
            nodes,
            edges: [
                { id: 'e1', source: 'a', target: 'b', label: 'pide' },
                { id: 'e2', source: 'a', target: 'b', label: 'responde' },
            ],
        });
        const positions = [
            { id: 'a', x: 0,   y: 0, width: 260, height: 160 },
            { id: 'b', x: 400, y: 0, width: 260, height: 160 },
            { id: 'c', x: 800, y: 0, width: 260, height: 160 },
        ];
        const result = lintEdgeLabelCollisions(diagram, positions);
        expect(result).toHaveLength(1);
        expect(result[0].code).toBe('VISUAL_EDGE_LABEL_COLLISION');
    });

    it('does not fire when only one label is present', () => {
        const diagram = ir({
            nodes: [node('a'), node('b')],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'invoca' }],
        });
        expect(lintEdgeLabelCollisions(diagram)).toEqual([]);
    });
});

describe('lintProcessTerminus', () => {
    it('fires when a process archetype lacks a start or end keyword', () => {
        const diagram = ir({
            metadata: { title: 'Proceso de Adjudicación' },
            nodes: [
                node('a', 'Recibe reclamo'),
                node('b', 'Valida'),
                node('c', 'Adjudica'),
                node('d', 'Notifica'),
            ],
        });
        const result = lintProcessTerminus(diagram);
        expect(result).toHaveLength(1);
        expect(result[0].code).toBe('VISUAL_PROCESS_MISSING_TERMINUS');
    });

    it('does not fire when start/end nodes exist', () => {
        const diagram = ir({
            metadata: { title: 'Proceso de Adjudicación' },
            nodes: [
                node('start', 'Inicio'),
                node('b', 'Valida'),
                node('end', 'Fin'),
            ],
        });
        expect(lintProcessTerminus(diagram)).toEqual([]);
    });

    it('does not fire for non-process archetypes', () => {
        const diagram = ir({
            metadata: { title: 'Diagrama de Contenedores' },
            nodes: [node('a'), node('b'), node('c'), node('d')],
        });
        expect(lintProcessTerminus(diagram)).toEqual([]);
    });
});

describe('lintValueStreamOrientation', () => {
    it('fires when value stream is laid out vertically', () => {
        const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`));
        const positions = nodes.map((n, i) => ({
            id: n.id, x: 0, y: i * 220, width: 260, height: 160,
        }));
        const diagram = ir({ metadata: { title: 'Mapa de Flujo de Valor' }, nodes });
        const result = lintValueStreamOrientation(diagram, positions);
        expect(result).toHaveLength(1);
        expect(result[0].code).toBe('VISUAL_VALUE_STREAM_NOT_HORIZONTAL');
    });

    it('does not fire when value stream is horizontal', () => {
        const nodes = Array.from({ length: 6 }, (_, i) => node(`n${i}`));
        const positions = nodes.map((n, i) => ({
            id: n.id, x: i * 320, y: 0, width: 260, height: 160,
        }));
        const diagram = ir({ metadata: { title: 'Mapa de Flujo de Valor' }, nodes });
        expect(lintValueStreamOrientation(diagram, positions)).toEqual([]);
    });
});

describe('lintIntegrationLayering', () => {
    it('fires when integration diagram lacks layered groups', () => {
        const diagram = ir({
            metadata: { title: 'Diagrama de Integración' },
            nodes: Array.from({ length: 8 }, (_, i) => node(`n${i}`)),
            groups: [],
        });
        const result = lintIntegrationLayering(diagram);
        expect(result).toHaveLength(1);
        expect(result[0].code).toBe('VISUAL_INTEGRATION_LAYERING_MISSING');
    });

    it('does not fire when at least two layer keywords appear in groups', () => {
        const diagram = ir({
            metadata: { title: 'Diagrama de Integración' },
            nodes: Array.from({ length: 8 }, (_, i) => node(`n${i}`)),
            groups: [
                { id: 'g1', label: 'Canales', nodeIds: ['n0', 'n1'] },
                { id: 'g2', label: 'Capa de Integración', nodeIds: ['n2', 'n3'] },
                { id: 'g3', label: 'Datos', nodeIds: ['n4', 'n5'] },
            ],
        });
        expect(lintIntegrationLayering(diagram)).toEqual([]);
    });
});

describe('lintDensity', () => {
    it('fires when the diagram exceeds the dense threshold', () => {
        const nodes = Array.from({ length: 40 }, (_, i) => node(`n${i}`));
        const result = lintDensity(ir({ nodes }));
        expect(result.some((i) => i.code === 'VISUAL_TOO_DENSE')).toBe(true);
    });

    it('flags very large single groups', () => {
        const nodes = Array.from({ length: 18 }, (_, i) => node(`n${i}`));
        const result = lintDensity(ir({
            nodes,
            groups: [{ id: 'g', label: 'Backend', nodeIds: nodes.map((n) => n.id).slice(0, 16) }],
        }));
        expect(result.some((i) => i.code === 'VISUAL_DENSITY_VARIANCE')).toBe(true);
    });
});

describe('collectVisualLints', () => {
    it('returns a flat list of issues for a problematic diagram', () => {
        // A vertical value stream missing start/end with collisions: should
        // trigger several lints at once.
        const nodes = Array.from({ length: 12 }, (_, i) => node(`n${i}`));
        const diagram = ir({
            metadata: { title: 'Mapa de Flujo de Valor' },
            nodes,
            edges: [
                { id: 'e1', source: 'n0', target: 'n1', label: 'paso 1' },
                { id: 'e2', source: 'n0', target: 'n1', label: 'paso 2' },
            ],
        });
        const result = collectVisualLints(diagram);
        // Always a stable shape.
        expect(Array.isArray(result)).toBe(true);
        for (const item of result) {
            expect(item.id).toBeTruthy();
            expect(item.severity).toBeDefined();
            expect(item.message).toBeTruthy();
            expect(item.recommendation).toBeTruthy();
        }
    });

    it('returns an empty list for a clean diagram', () => {
        const diagram = ir({
            nodes: [node('a', 'API'), node('b', 'DB')],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'JDBC' }],
        });
        expect(collectVisualLints(diagram)).toEqual([]);
    });
});

describe('pseudoLayoutForLints', () => {
    it('produces a stable grid for n nodes', () => {
        const diagram = ir({ nodes: Array.from({ length: 9 }, (_, i) => node(`n${i}`)) });
        const positions = pseudoLayoutForLints(diagram);
        expect(positions).toHaveLength(9);
        for (const p of positions) {
            expect(Number.isFinite(p.x)).toBe(true);
            expect(Number.isFinite(p.y)).toBe(true);
        }
    });
});

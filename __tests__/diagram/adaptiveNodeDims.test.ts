import { describe, it, expect } from 'vitest';
import { estimateNodeDims, LAYOUT_PRESETS } from '../../lib/diagramTokens';
import { chooseRanker, layoutIR } from '../../lib/layoutEngine';
import type { DiagramIR } from '../../lib/diagram';

describe('estimateNodeDims', () => {
    it('gives terse nodes a narrower card than the fixed preset', () => {
        const dims = estimateNodeDims({ label: 'API' });
        expect(dims.width).toBeLessThan(LAYOUT_PRESETS.flow.node.width);
        expect(dims.width).toBeGreaterThanOrEqual(220);
    });

    it('widens for long labels but clamps at the maximum', () => {
        const dims = estimateNodeDims({ label: 'Plataforma de Integración Corporativa de Beneficios Farmacéuticos' });
        expect(dims.width).toBeLessThanOrEqual(320);
        expect(dims.width).toBeGreaterThan(estimateNodeDims({ label: 'API' }).width);
    });

    it('adds height for described nodes and none for compact density', () => {
        const withDesc = estimateNodeDims({
            label: 'Servicio Elegibilidad',
            description: 'Valida cobertura y copagos de cada afiliado contra el plan vigente y las reglas del PBM.',
        });
        const withoutDesc = estimateNodeDims({ label: 'Servicio Elegibilidad' });
        expect(withDesc.height).toBeGreaterThan(withoutDesc.height);

        const compact = estimateNodeDims(
            { label: 'Servicio Elegibilidad', description: 'Valida cobertura.' },
            'compact',
        );
        expect(compact.height).toBeLessThan(withDesc.height);
        expect(compact.width).toBeGreaterThanOrEqual(190);
    });

    it('reserves headroom for decorated shapes (cylinder / person)', () => {
        const plain = estimateNodeDims({ label: 'BD Clientes' });
        const cylinder = estimateNodeDims({ label: 'BD Clientes', shape: 'cylinder' });
        expect(cylinder.height).toBeGreaterThan(plain.height);
    });
});

describe('layoutIR with per-node dims', () => {
    const ir: DiagramIR = {
        nodes: [
            { id: 'a', label: 'API', kind: 'gateway' },
            { id: 'b', label: 'Plataforma de Integración Corporativa de Beneficios', kind: 'service' },
        ],
        edges: [{ id: 'e1', source: 'a', target: 'b', label: 'Orquesta' }],
        groups: [],
    };

    it('reserves the estimated box per node instead of the fixed preset', () => {
        const result = layoutIR(ir, {
            preset: 'flow',
            direction: 'TB',
            nodeDims: (node) => estimateNodeDims(node),
        });
        const a = result.positions.get('a')!;
        const b = result.positions.get('b')!;
        expect(a.width).toBe(estimateNodeDims(ir.nodes[0]).width);
        expect(b.width).toBe(estimateNodeDims(ir.nodes[1]).width);
        expect(a.width).not.toBe(b.width);
    });

    it('keeps the preset dimensions when no estimator is provided (legacy contract)', () => {
        const result = layoutIR(ir, { preset: 'flow', direction: 'TB' });
        expect(result.positions.get('a')!.width).toBe(LAYOUT_PRESETS.flow.node.width);
        expect(result.positions.get('a')!.height).toBe(LAYOUT_PRESETS.flow.node.height);
    });
});

describe('chooseRanker', () => {
    it('uses tight-tree for tree-like graphs (shorter edges, fewer crossings)', () => {
        expect(chooseRanker(10, 9)).toBe('tight-tree');
        expect(chooseRanker(10, 10)).toBe('tight-tree');
    });

    it('keeps network-simplex for densely connected graphs', () => {
        expect(chooseRanker(10, 17)).toBe('network-simplex');
        expect(chooseRanker(0, 0)).toBe('network-simplex');
    });
});

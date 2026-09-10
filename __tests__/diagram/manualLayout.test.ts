import { describe, it, expect } from 'vitest';
import type { Node } from 'reactflow';
import type { DiagramIR } from '../../lib/diagram';
import { hasManualLayout, irToReactFlow, irToReactFlowSmart } from '../../services/diagram/irToReactFlow';
import { toDiagramIR, mergeIRMetadata } from '../../services/diagram/quality/diagramQualityService';

function buildIR(partial: Partial<DiagramIR> = {}): DiagramIR {
    return {
        nodes: partial.nodes ?? [],
        edges: partial.edges ?? [],
        groups: partial.groups ?? [],
        metadata: partial.metadata,
    };
}

const manualIR = (): DiagramIR => buildIR({
    nodes: [
        { id: 'a', label: 'Portal', kind: 'service', position: { x: 100, y: 40 } },
        { id: 'b', label: 'API', kind: 'gateway', position: { x: 480, y: 40 } },
        { id: 'c', label: 'BD Clientes', kind: 'data', position: { x: 480, y: 320 } },
    ],
    edges: [
        { id: 'e1', source: 'a', target: 'b', label: 'Solicita', relation: 'sync' },
        { id: 'e2', source: 'b', target: 'c', label: 'Consulta', relation: 'data-flow' },
    ],
    metadata: { layoutMode: 'manual' },
});

describe('hasManualLayout', () => {
    it('is true when metadata declares manual and nodes carry positions', () => {
        expect(hasManualLayout(manualIR())).toBe(true);
    });

    it('is false without the manual flag even when positions exist', () => {
        const ir = manualIR();
        ir.metadata = { layoutMode: 'auto' };
        expect(hasManualLayout(ir)).toBe(false);
    });

    it('is false when too few nodes carry positions (< 60%)', () => {
        const ir = manualIR();
        ir.nodes = ir.nodes.map((n, i) => (i === 0 ? n : { ...n, position: undefined }));
        expect(hasManualLayout(ir)).toBe(false);
    });
});

describe('irToReactFlow with manual layout', () => {
    it('renders nodes exactly at their persisted positions', () => {
        const result = irToReactFlow(manualIR());
        const byId = new Map(result.nodes.map((n) => [n.id, n] as const));
        expect(byId.get('a')?.position).toEqual({ x: 100, y: 40 });
        expect(byId.get('b')?.position).toEqual({ x: 480, y: 40 });
        expect(byId.get('c')?.position).toEqual({ x: 480, y: 320 });
        expect(result.edges).toHaveLength(2);
    });

    it('places nodes added after the manual pass on a visible grid below the content', () => {
        const ir = manualIR();
        ir.nodes.push({ id: 'nuevo', label: 'Servicio Nuevo', kind: 'service' });
        const result = irToReactFlow(ir);
        const added = result.nodes.find((n) => n.id === 'nuevo');
        expect(added).toBeDefined();
        expect(Number.isFinite(added!.position.x)).toBe(true);
        // Below the lowest manually-positioned node.
        expect(added!.position.y).toBeGreaterThan(320);
    });

    it('smart variant honours manual positions and reports a user-override plan', async () => {
        const result = await irToReactFlowSmart(manualIR(), 'mermaid-graph');
        const a = result.nodes.find((n) => n.id === 'a');
        expect(a?.position).toEqual({ x: 100, y: 40 });
        expect(result.plan.userOverride).toBe(true);
    });
});

describe('toDiagramIR position round-trip', () => {
    const canvasNodes: Node[] = [
        {
            id: 'a',
            type: 'custom',
            position: { x: 123.4, y: 56.7 },
            data: { label: 'Portal', kind: 'service' },
        },
        {
            id: 'b',
            type: 'custom',
            position: { x: 600, y: 80 },
            data: { label: 'API', kind: 'gateway' },
        },
    ];

    it('captures rounded canvas positions on every node', () => {
        const ir = toDiagramIR(canvasNodes, []);
        expect(ir.nodes.find((n) => n.id === 'a')?.position).toEqual({ x: 123, y: 57 });
        expect(ir.nodes.find((n) => n.id === 'b')?.position).toEqual({ x: 600, y: 80 });
    });

    it('positions survive mergeIRMetadata against a previous IR', () => {
        const fresh = toDiagramIR(canvasNodes, []);
        const previous = buildIR({
            nodes: [{ id: 'a', label: 'Portal', kind: 'service', owner: 'Equipo Canales' }],
            metadata: { layoutPlan: { backend: 'elk', direction: 'LR' } },
        });
        const merged = mergeIRMetadata(fresh, previous);
        const a = merged.nodes.find((n) => n.id === 'a');
        expect(a?.position).toEqual({ x: 123, y: 57 });
        // Previous semantic metadata still backfills.
        expect(a?.owner).toBe('Equipo Canales');
        expect(merged.metadata?.layoutPlan?.backend).toBe('elk');
    });
});

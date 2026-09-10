import { describe, it, expect } from 'vitest';
import type { Node, Edge } from 'reactflow';
import { toDiagramIR, mergeIRMetadata } from '../../services/diagram/quality/diagramQualityService';

describe('toDiagramIR — group metadata recovery (Gap 7)', () => {
    it('reads group.kind / purpose / boundaryType / owner / trust from group zone nodes', () => {
        const contentNodes: Node[] = [
            { id: 'a', type: 'custom', position: { x: 0, y: 0 }, data: { label: 'A', kind: 'service', group: 'PHI Zone' } },
            { id: 'b', type: 'custom', position: { x: 200, y: 0 }, data: { label: 'B', kind: 'service', group: 'PHI Zone' } },
        ];
        const groupZone: Node = {
            id: '__group__PHI Zone',
            type: 'groupZone',
            position: { x: -10, y: -10 },
            data: {
                label: 'PHI Zone',
                kind: 'security',
                purpose: 'Aislar datos clínicos sensibles',
                boundaryType: 'compliance',
                owner: 'Equipo Clinical Ops',
                trust: 'internal',
                groupId: 'g-phi',
            },
            style: { width: 320, height: 160 },
        };
        const edges: Edge[] = [{ id: 'e', source: 'a', target: 'b', label: 'comparte' }];
        const ir = toDiagramIR([...contentNodes, groupZone], edges);
        expect(ir.groups).toHaveLength(1);
        const g = ir.groups[0];
        expect(g.label).toBe('PHI Zone');
        expect(g.id).toBe('g-phi');
        expect(g.kind).toBe('security');
        expect(g.purpose).toContain('clínicos');
        expect(g.boundaryType).toBe('compliance');
        expect(g.owner).toBe('Equipo Clinical Ops');
        expect(g.trust).toBe('internal');
    });

    it('falls back to numeric ids when no group zone is provided', () => {
        const contentNodes: Node[] = [
            { id: 'a', type: 'custom', position: { x: 0, y: 0 }, data: { label: 'A', kind: 'service', group: 'Domain' } },
        ];
        const ir = toDiagramIR(contentNodes, []);
        expect(ir.groups[0].id).toBe('group-1');
        expect(ir.groups[0].kind).toBeUndefined();
    });

    it('mergeIRMetadata still backfills missing group metadata from the previous IR', () => {
        const fresh = toDiagramIR(
            [
                { id: 'a', type: 'custom', position: { x: 0, y: 0 }, data: { label: 'A', kind: 'service', group: 'PHI' } },
            ],
            [],
        );
        const previous = {
            nodes: [{ id: 'a', label: 'A', kind: 'service' }],
            edges: [],
            groups: [{ id: 'g', label: 'PHI', nodeIds: ['a'], kind: 'security' as const, purpose: 'Aislar PHI' }],
        };
        const merged = mergeIRMetadata(fresh, previous);
        expect(merged.groups[0].kind).toBe('security');
        expect(merged.groups[0].purpose).toBe('Aislar PHI');
    });
});

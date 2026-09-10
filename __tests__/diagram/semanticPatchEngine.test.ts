/**
 * Specs for the semantic patch engine.
 *
 * The property that matters most is the invariant, not any single operation:
 * whatever a patch does, the IR that comes out must still be one the renderers
 * and the lint rules accept — unique ids, no edge to a node that is gone, no
 * group naming a member that no longer exists, no annotation pointing at
 * nothing. That is precisely what "regenerate the whole diagram" never had to
 * guarantee, and it is why a patch has to.
 */

import { describe, expect, it } from 'vitest';

import type { DiagramIR, DiagramPatch, DiagramPatchOperation } from '../../lib/diagram';
import { applySemanticPatch, describeSemanticPatch } from '../../services/diagram/semanticPatchEngine';

const baseIR = (): DiagramIR => ({
    nodes: [
        { id: 'cliente', label: 'Cliente', kind: 'person' },
        { id: 'api', label: 'API de reservas', kind: 'service' },
        { id: 'db', label: 'Reservas DB', kind: 'data' },
    ],
    edges: [
        { id: 'e1', source: 'cliente', target: 'api', label: 'reserva' },
        { id: 'e2', source: 'api', target: 'db', label: 'persiste' },
    ],
    groups: [{ id: 'g1', label: 'Backend', nodeIds: ['api', 'db'] }],
    metadata: {
        narrative: {
            summary: 'La reserva pasa por una única API.',
            callouts: [{ id: 'c1', targetId: 'db', targetKind: 'node', text: 'Único almacén.' }],
        },
    },
});

const patch = (...operations: DiagramPatchOperation[]): DiagramPatch =>
    ({ id: 'p1', source: 'ai', operations });

/** The invariant every result must satisfy, whatever the operations were. */
const expectIntegrity = (ir: DiagramIR) => {
    const nodeIds = new Set(ir.nodes.map(node => node.id));
    expect(nodeIds.size).toBe(ir.nodes.length);
    const edgeIds = new Set(ir.edges.map(edge => edge.id));
    expect(edgeIds.size).toBe(ir.edges.length);
    for (const edge of ir.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
    }
    for (const group of ir.groups) {
        expect(group.nodeIds.length).toBeGreaterThan(0);
        for (const id of group.nodeIds) expect(nodeIds.has(id)).toBe(true);
    }
    const narrative = ir.metadata?.narrative;
    if (narrative && typeof narrative !== 'string') {
        for (const callout of narrative.callouts ?? []) {
            expect(nodeIds.has(callout.targetId) || edgeIds.has(callout.targetId)).toBe(true);
        }
    }
};

describe('a patch that changes nothing says so', () => {
    it('returns the original object for an empty patch', () => {
        const ir = baseIR();
        const result = applySemanticPatch(ir, patch());
        expect(result.changed).toBe(false);
        expect(result.ir).toBe(ir);
    });

    it('returns the original object when every operation is rejected', () => {
        const ir = baseIR();
        const result = applySemanticPatch(ir, patch({ op: 'remove-node', nodeId: 'fantasma' }));
        expect(result.changed).toBe(false);
        expect(result.ir).toBe(ir);
        expect(result.rejected[0]).toMatchObject({ op: 'remove-node', code: 'unknown-node' });
    });

    it('never mutates the IR it was given', () => {
        const ir = baseIR();
        const before = JSON.stringify(ir);
        applySemanticPatch(ir, patch({ op: 'remove-node', nodeId: 'db' }));
        expect(JSON.stringify(ir)).toBe(before);
    });
});

describe('references are checked before anything is applied', () => {
    it.each<[string, DiagramPatchOperation, string]>([
        ['a node that does not exist', { op: 'update-node', nodeId: 'x', changes: { label: 'Y' } }, 'unknown-node'],
        ['an edge that does not exist', { op: 'remove-edge', edgeId: 'x' }, 'unknown-edge'],
        ['a group that does not exist', { op: 'ungroup', groupId: 'x' }, 'unknown-group'],
        ['an annotation that does not exist', { op: 'remove-callout', calloutId: 'x' }, 'unknown-callout'],
        ['an edge into nowhere', { op: 'add-edge', edge: { id: 'e9', source: 'api', target: 'x', label: '' } }, 'unknown-node'],
        ['a node id already taken', { op: 'add-node', node: { id: 'api', label: 'Otra', kind: 'service' } }, 'duplicate-id'],
        ['an annotation with no target', { op: 'add-callout', callout: { id: 'c9', targetId: 'x', text: 'Ojo.' } }, 'unknown-node'],
        ['a node with no label', { op: 'add-node', node: { id: 'n9', label: '', kind: 'service' } }, 'invalid-shape'],
        ['an update that changes nothing', { op: 'update-node', nodeId: 'api', changes: {} }, 'no-effect'],
    ])('rejects %s', (_label, operation, code) => {
        const result = applySemanticPatch(baseIR(), patch(operation));
        expect(result.rejected).toHaveLength(1);
        expect(result.rejected[0].code).toBe(code);
        expect(result.rejected[0].message.length).toBeGreaterThan(0);
    });

    it('rejects an operation kind it does not implement instead of ignoring it', () => {
        const result = applySemanticPatch(baseIR(), patch({ op: 'teletransportar' } as unknown as DiagramPatchOperation));
        expect(result.rejected[0]).toMatchObject({ code: 'invalid-shape' });
        expect(result.changed).toBe(false);
    });

    it('keeps the good operations when one beside them is bad', () => {
        const result = applySemanticPatch(baseIR(), patch(
            { op: 'update-node', nodeId: 'api', changes: { label: 'API v2' } },
            { op: 'remove-node', nodeId: 'fantasma' },
            { op: 'update-edge', edgeId: 'e1', changes: { criticality: 'critical' } },
        ));
        expect(result.applied).toHaveLength(2);
        expect(result.rejected).toHaveLength(1);
        expect(result.ir.nodes.find(node => node.id === 'api')?.label).toBe('API v2');
        expect(result.ir.edges.find(edge => edge.id === 'e1')?.criticality).toBe('critical');
        expectIntegrity(result.ir);
    });
});

describe('the cascade is performed and reported', () => {
    it('takes the edges, the group membership and the annotations with a removed node', () => {
        const result = applySemanticPatch(baseIR(), patch({ op: 'remove-node', nodeId: 'db' }));
        expect(result.ir.edges.map(edge => edge.id)).toEqual(['e1']);
        expect(result.ir.groups[0].nodeIds).toEqual(['api']);
        const narrative = result.ir.metadata?.narrative;
        expect(typeof narrative === 'object' && narrative?.callouts).toEqual([]);
        expect(result.applied[0].cascaded?.join(' ')).toContain('e2');
        expectIntegrity(result.ir);
    });

    it('drops a group left empty rather than leaving one with no members', () => {
        const ir = baseIR();
        ir.groups = [{ id: 'solo', label: 'Solo', nodeIds: ['db'] }];
        const result = applySemanticPatch(ir, patch({ op: 'remove-node', nodeId: 'db' }));
        expect(result.ir.groups).toEqual([]);
        expectIntegrity(result.ir);
    });

    it('refuses to empty the diagram', () => {
        const ir: DiagramIR = { nodes: [{ id: 'a', label: 'A', kind: 'service' }], edges: [], groups: [] };
        const result = applySemanticPatch(ir, patch({ op: 'remove-node', nodeId: 'a' }));
        expect(result.rejected[0].code).toBe('empty-result');
    });

    it('takes an annotation with the edge it was about', () => {
        const ir = baseIR();
        (ir.metadata!.narrative as { callouts: unknown[] }).callouts = [
            { id: 'c2', targetId: 'e2', targetKind: 'edge', text: 'Escritura crítica.' },
        ];
        const result = applySemanticPatch(ir, patch({ op: 'remove-edge', edgeId: 'e2' }));
        expect(result.applied[0].cascaded?.join(' ')).toContain('anotación');
        expectIntegrity(result.ir);
    });
});

describe('grouping', () => {
    it('creates a group and drops ids that do not exist, saying how many', () => {
        const result = applySemanticPatch(baseIR(), patch({
            op: 'group-nodes',
            group: { id: 'g2', label: 'Frontal', nodeIds: ['cliente', 'inexistente'] },
        }));
        expect(result.ir.groups.find(group => group.id === 'g2')?.nodeIds).toEqual(['cliente']);
        expect(result.applied[0].cascaded?.join(' ')).toContain('1');
        expectIntegrity(result.ir);
    });

    it('keeps the nodes when a group is undone', () => {
        const result = applySemanticPatch(baseIR(), patch({ op: 'ungroup', groupId: 'g1' }));
        expect(result.ir.groups).toEqual([]);
        expect(result.ir.nodes).toHaveLength(3);
    });

    it('adds and removes members, and drops the group when it empties', () => {
        const added = applySemanticPatch(baseIR(), patch({ op: 'add-to-group', groupId: 'g1', nodeIds: ['cliente'] }));
        expect(added.ir.groups[0].nodeIds).toEqual(['api', 'db', 'cliente']);
        const emptied = applySemanticPatch(added.ir, patch({
            op: 'remove-from-group', groupId: 'g1', nodeIds: ['api', 'db', 'cliente'],
        }));
        expect(emptied.ir.groups).toEqual([]);
        expect(emptied.applied[0].cascaded?.join(' ')).toContain('vacía');
    });
});

describe('annotations and layout intent', () => {
    it('adds an annotation and infers whether it is about a node or an edge', () => {
        const result = applySemanticPatch(baseIR(), patch({
            op: 'add-callout',
            callout: { id: 'c2', targetId: 'e1', text: 'Punto de entrada.' },
        }));
        const narrative = result.ir.metadata?.narrative;
        expect(typeof narrative === 'object' && narrative?.callouts?.at(-1)).toMatchObject({
            targetId: 'e1',
            targetKind: 'edge',
        });
    });

    it('marks a layout hint as a user override so the selector will not revert it', () => {
        const result = applySemanticPatch(baseIR(), patch({ op: 'set-layout-hint', direction: 'LR', density: 'spacious' }));
        expect(result.ir.metadata?.layoutPlan).toMatchObject({
            direction: 'LR',
            density: 'spacious',
            userOverride: true,
        });
    });

    it('rejects a layout hint that declares neither direction nor density', () => {
        expect(applySemanticPatch(baseIR(), patch({ op: 'set-layout-hint' })).rejected[0].code).toBe('no-effect');
    });

    it('does not grow a narrative on a diagram that never had one', () => {
        const ir: DiagramIR = { nodes: [{ id: 'a', label: 'A', kind: 'service' }], edges: [], groups: [] };
        const result = applySemanticPatch(ir, patch({ op: 'update-node', nodeId: 'a', changes: { label: 'B' } }));
        expect(result.ir.metadata?.narrative).toBeUndefined();
    });
});

describe('the preview is the apply, run against a copy', () => {
    it('describes exactly what applying would do, including the cascade', () => {
        const ir = baseIR();
        const proposal = patch({ op: 'remove-node', nodeId: 'db' }, { op: 'remove-edge', edgeId: 'fantasma' });
        const preview = describeSemanticPatch(ir, proposal);
        const applied = applySemanticPatch(ir, proposal);
        expect(preview.applied).toEqual(applied.applied);
        expect(preview.rejected).toEqual(applied.rejected);
        expect(preview.changed).toBe(applied.changed);
    });

    it('leaves the diagram untouched while previewing', () => {
        const ir = baseIR();
        const before = JSON.stringify(ir);
        describeSemanticPatch(ir, patch({ op: 'remove-node', nodeId: 'api' }));
        expect(JSON.stringify(ir)).toBe(before);
    });
});

/**
 * The invariant, over sequences nobody wrote by hand.
 *
 * Each individual spec above pins one operation. This one asserts the thing
 * that actually protects the renderers: *no* sequence of operations, valid or
 * not, in any order, leaves an IR the pipeline would reject. It is
 * deterministic — a seeded generator, so a failure is reproducible rather than
 * a flake somebody re-runs until it passes.
 */
describe('no sequence of operations leaves a broken diagram', () => {
    const seededRandom = (seed: number) => () => {
        // Mulberry32 — small, fast and reproducible.
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const candidates = (n: number): DiagramPatchOperation[] => {
        const ids = ['cliente', 'api', 'db', 'fantasma', ''];
        const pick = <T,>(list: T[], r: number): T => list[Math.floor(r * list.length) % list.length];
        return Array.from({ length: n }, (_, index) => {
            const r = seededRandom(index * 7919 + n * 104729);
            const kind = Math.floor(r() * 12);
            const target = pick(ids, r());
            switch (kind) {
                case 0: return { op: 'add-node', node: { id: `new-${index}`, label: `Nodo ${index}`, kind: 'service' } };
                case 1: return { op: 'remove-node', nodeId: target };
                case 2: return { op: 'update-node', nodeId: target, changes: { label: `Renombrado ${index}` } };
                case 3: return { op: 'add-edge', edge: { id: `ne-${index}`, source: target, target: pick(ids, r()), label: '' } };
                case 4: return { op: 'remove-edge', edgeId: pick(['e1', 'e2', 'ne-0', 'x'], r()) };
                case 5: return { op: 'update-edge', edgeId: pick(['e1', 'e2', 'x'], r()), changes: { criticality: 'critical' } };
                case 6: return { op: 'group-nodes', group: { id: `ng-${index}`, label: `Grupo ${index}`, nodeIds: [target, pick(ids, r())] } };
                case 7: return { op: 'ungroup', groupId: pick(['g1', `ng-0`, 'x'], r()) };
                case 8: return { op: 'add-to-group', groupId: pick(['g1', 'x'], r()), nodeIds: [target] };
                case 9: return { op: 'remove-from-group', groupId: pick(['g1', 'x'], r()), nodeIds: [target] };
                case 10: return { op: 'add-callout', callout: { id: `nc-${index}`, targetId: target, text: 'Nota.' } };
                default: return { op: 'remove-callout', calloutId: pick(['c1', 'nc-0', 'x'], r()) };
            }
        });
    };

    it.each([1, 2, 3, 5, 8, 13, 21])('holds for a %i-operation patch', (length) => {
        const result = applySemanticPatch(baseIR(), patch(...candidates(length)));
        expectIntegrity(result.ir);
        // Every operation is accounted for — none is silently dropped.
        expect(result.applied.length + result.rejected.length).toBe(length);
        expect(result.changed).toBe(result.applied.length > 0);
    });

    it('holds when patches are chained onto each other', () => {
        let ir = baseIR();
        for (let round = 1; round <= 8; round++) {
            ir = applySemanticPatch(ir, patch(...candidates(round))).ir;
            expectIntegrity(ir);
        }
        expect(ir.nodes.length).toBeGreaterThan(0);
    });
});

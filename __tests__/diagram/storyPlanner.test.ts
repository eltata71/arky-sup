import { describe, expect, it } from 'vitest';

import type { DiagramIR } from '../../lib/diagram';
import {
    buildStoryPlan,
    resolvePrimaryPathFocus,
    resolveStoryFocus,
    MAX_STORY_HOTSPOTS,
    MAX_STORY_STEPS,
} from '../../services/diagram/storyPlanner';

const ir = (partial: Partial<DiagramIR>): DiagramIR => ({
    nodes: [],
    edges: [],
    groups: [],
    ...partial,
});

const chain = (length: number): DiagramIR => ir({
    nodes: Array.from({ length }, (_, index) => ({ id: `n${index}`, label: `Nodo ${index}`, kind: 'service' })),
    edges: Array.from({ length: length - 1 }, (_, index) => ({
        id: `e${index}`,
        source: `n${index}`,
        target: `n${index + 1}`,
        label: 'llama a',
    })),
});

describe('buildStoryPlan — nothing to tell', () => {
    it('returns null for an empty diagram rather than an empty plan', () => {
        expect(buildStoryPlan(ir({}))).toBeNull();
    });

    it('plans a single-node diagram without inventing a path', () => {
        const plan = buildStoryPlan(ir({ nodes: [{ id: 'a', label: 'Solo', kind: 'system' }] }));
        expect(plan).not.toBeNull();
        expect(plan?.primaryPath).toBeNull();
        expect(plan?.steps).toHaveLength(1);
    });
});

describe('buildStoryPlan — derivation is marked and never invents an argument', () => {
    it('marks a topology-derived plan as derived', () => {
        expect(buildStoryPlan(chain(4))?.source).toBe('derived');
    });

    it('leaves the primary message and the conclusion null when nobody wrote one', () => {
        const plan = buildStoryPlan(chain(4));
        expect(plan?.primaryMessage).toBeNull();
        expect(plan?.conclusion).toBeNull();
    });

    it('does not treat a plain-string narrative as an authored story', () => {
        const plan = buildStoryPlan(ir({
            ...chain(3),
            metadata: { narrative: 'flujo centrado en el sistema, optimizado para el valor de negocio.' },
        }));
        expect(plan?.source).toBe('derived');
        expect(plan?.primaryMessage).toBeNull();
    });

    it('does not treat an empty narrative object as authored', () => {
        const plan = buildStoryPlan(ir({ ...chain(3), metadata: { narrative: { scenes: [], callouts: [] } } }));
        expect(plan?.source).toBe('derived');
    });
});

describe('buildStoryPlan — entry points and reading order', () => {
    it('starts at the nodes nothing points to', () => {
        const plan = buildStoryPlan(chain(4));
        expect(plan?.entryPointIds).toEqual(['n0']);
        expect(plan?.steps[0]?.nodeIds).toEqual(['n0']);
    });

    it('falls back to human actors when the graph is fully cyclic', () => {
        const plan = buildStoryPlan(ir({
            nodes: [
                { id: 'a', label: 'Servicio A', kind: 'service' },
                { id: 'p', label: 'Analista', kind: 'person', semanticRole: 'person' },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'p', label: 'notifica' },
                { id: 'e2', source: 'p', target: 'a', label: 'consulta' },
            ],
        }));
        expect(plan?.entryPointIds).toEqual(['p']);
    });

    it('terminates on a cycle instead of walking it forever', () => {
        const cyclic = ir({
            nodes: [
                { id: 'a', label: 'A', kind: 'service' },
                { id: 'b', label: 'B', kind: 'service' },
                { id: 'c', label: 'C', kind: 'service' },
            ],
            edges: [
                { id: 'e1', source: 'a', target: 'b', label: '' },
                { id: 'e2', source: 'b', target: 'c', label: '' },
                { id: 'e3', source: 'c', target: 'a', label: '' },
            ],
        });
        const plan = buildStoryPlan(cyclic);
        expect(plan?.steps.length).toBeGreaterThan(0);
        // The path must not close the loop: a highlight that lists the same
        // node twice draws a route the reader cannot follow.
        const path = plan?.primaryPath?.nodeIds ?? [];
        expect(new Set(path).size).toBe(path.length);
        expect(path.length).toBeLessThanOrEqual(3);
    });

    it('covers every node even across disconnected components', () => {
        const plan = buildStoryPlan(ir({
            nodes: [
                { id: 'a', label: 'A', kind: 'service' },
                { id: 'b', label: 'B', kind: 'service' },
                { id: 'island', label: 'Isla', kind: 'service' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: '' }],
        }));
        const covered = new Set(plan?.steps.flatMap(step => step.nodeIds));
        expect(covered).toEqual(new Set(['a', 'b', 'island']));
    });

    it('caps the walk so it stays a story rather than a list', () => {
        const plan = buildStoryPlan(chain(40));
        expect(plan?.steps.length).toBeLessThanOrEqual(MAX_STORY_STEPS);
    });

    it('reads the direction off the persisted layout plan', () => {
        const plan = buildStoryPlan(ir({
            ...chain(3),
            metadata: { layoutPlan: { backend: 'elk', direction: 'LR' } },
        }));
        expect(plan?.readingDirection).toBe('LR');
    });
});

describe('buildStoryPlan — the primary path follows declared criticality', () => {
    it('prefers the critical branch over the longer indifferent one', () => {
        const plan = buildStoryPlan(ir({
            nodes: [
                { id: 'in', label: 'Entrada', kind: 'person' },
                { id: 'crit', label: 'Autorización', kind: 'service' },
                { id: 'l1', label: 'Log 1', kind: 'service' },
                { id: 'l2', label: 'Log 2', kind: 'service' },
            ],
            edges: [
                { id: 'ec', source: 'in', target: 'crit', label: 'autoriza', criticality: 'critical' },
                { id: 'e1', source: 'in', target: 'l1', label: 'registra' },
                { id: 'e2', source: 'l1', target: 'l2', label: 'archiva' },
            ],
        }));
        expect(plan?.primaryPath?.edgeIds).toEqual(['ec']);
        expect(plan?.primaryPath?.rationale).toContain('criticidad');
    });

    it('says so when no interaction declares criticality', () => {
        expect(buildStoryPlan(chain(3))?.primaryPath?.rationale).toContain('ninguna interacción declara criticidad');
    });

    it('leaves everything off the path as secondary context', () => {
        const plan = buildStoryPlan(ir({
            nodes: [
                { id: 'a', label: 'A', kind: 'service' },
                { id: 'b', label: 'B', kind: 'service' },
                { id: 'aside', label: 'Aparte', kind: 'service' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: '' }],
        }));
        expect(plan?.secondaryContextIds).toContain('aside');
        expect(plan?.secondaryContextIds).not.toContain('a');
    });

    it('ignores edges whose ends do not exist', () => {
        const plan = buildStoryPlan(ir({
            nodes: [{ id: 'a', label: 'A', kind: 'service' }],
            edges: [{ id: 'ghost', source: 'a', target: 'missing', label: '' }],
        }));
        expect(plan?.primaryPath).toBeNull();
    });
});

describe('buildStoryPlan — hotspots', () => {
    it('raises the elements that declare risk, failure and sensitivity', () => {
        const plan = buildStoryPlan(ir({
            nodes: [
                { id: 'a', label: 'Core', kind: 'service', status: 'error' },
                { id: 'b', label: 'Bóveda', kind: 'database', dataClassification: 'phi' },
                { id: 'c', label: 'Normal', kind: 'service' },
            ],
            edges: [{ id: 'e1', source: 'a', target: 'b', label: 'lee', criticality: 'critical' }],
        }));
        const targets = plan?.hotspots.map(hotspot => hotspot.targetId) ?? [];
        expect(targets).toContain('a');
        expect(targets).toContain('b');
        expect(targets).toContain('e1');
        expect(targets).not.toContain('c');
    });

    it('puts the critical ones first and caps the list', () => {
        const plan = buildStoryPlan(ir({
            nodes: [
                ...Array.from({ length: 10 }, (_, index) => ({
                    id: `w${index}`,
                    label: `Aviso ${index}`,
                    kind: 'service',
                    status: 'warning' as const,
                })),
                { id: 'boom', label: 'Caído', kind: 'service', status: 'error' as const },
            ],
            edges: [],
        }));
        expect(plan?.hotspots).toHaveLength(MAX_STORY_HOTSPOTS);
        expect(plan?.hotspots[0]?.targetId).toBe('boom');
        expect(plan?.hotspots[0]?.severity).toBe('critical');
    });

    it('is stable across runs over the same diagram', () => {
        const source = ir({
            nodes: [
                { id: 'a', label: 'A', kind: 'service', criticality: 'high' },
                { id: 'b', label: 'B', kind: 'service', criticality: 'critical' },
                { id: 'c', label: 'C', kind: 'service', status: 'warning' },
            ],
            edges: [],
        });
        expect(buildStoryPlan(source)?.hotspots).toEqual(buildStoryPlan(source)?.hotspots);
    });
});

describe('buildStoryPlan — an authored story wins, and its broken links are reported', () => {
    const authored = (): DiagramIR => ir({
        ...chain(4),
        metadata: {
            narrative: {
                summary: 'El cobro depende de un único proveedor externo.',
                scenes: [
                    { id: 'sc-1', title: 'La petición entra', focusNodeIds: ['n0', 'n1'], focusEdgeIds: ['e0'], insight: 'Todo empieza aquí.' },
                    { id: 'sc-2', title: 'El cobro', focusNodeIds: ['n2'], focusEdgeIds: ['e1'] },
                ],
                callouts: [
                    { id: 'co-1', targetId: 'n2', targetKind: 'node', text: 'Punto único de fallo.', severity: 'critical' },
                ],
            },
        },
    });

    it('uses the written scenes instead of rebuilding them from topology', () => {
        const plan = buildStoryPlan(authored());
        expect(plan?.source).toBe('authored');
        expect(plan?.steps.map(step => step.title)).toEqual(['La petición entra', 'El cobro']);
        expect(plan?.steps[0]?.insight).toBe('Todo empieza aquí.');
    });

    it('carries the written message rather than a composed one', () => {
        expect(buildStoryPlan(authored())?.primaryMessage).toBe('El cobro depende de un único proveedor externo.');
    });

    it('turns callouts into hotspots bound to their element', () => {
        const hotspots = buildStoryPlan(authored())?.hotspots ?? [];
        expect(hotspots).toHaveLength(1);
        expect(hotspots[0]).toMatchObject({ targetId: 'n2', targetKind: 'node', severity: 'critical' });
    });

    it('reports ids the narrative points at that the diagram no longer has', () => {
        const stale = authored();
        stale.metadata!.narrative = {
            summary: 'Una historia escrita contra un diagrama anterior.',
            scenes: [{ id: 'sc-1', title: 'Paso', focusNodeIds: ['n0', 'borrado'], focusEdgeIds: [] }],
            callouts: [{ id: 'co-x', targetId: 'tambien-borrado', targetKind: 'node', text: 'Ojo.' }],
        };
        const plan = buildStoryPlan(stale);
        expect(plan?.unresolvedReferences.sort()).toEqual(['borrado', 'tambien-borrado']);
        expect(plan?.steps[0]?.nodeIds).toEqual(['n0']);
    });

    it('falls back to derived hotspots when the narrative declares no callouts', () => {
        const plan = buildStoryPlan(ir({
            nodes: [{ id: 'a', label: 'A', kind: 'service', status: 'error' }],
            edges: [],
            groups: [],
            metadata: { narrative: { summary: 'Sólo un resumen.' } },
        }));
        expect(plan?.source).toBe('authored');
        expect(plan?.hotspots.map(hotspot => hotspot.targetId)).toEqual(['a']);
    });
});

describe('resolveStoryFocus / resolvePrimaryPathFocus', () => {
    it('resolves a step to the ids it brings into focus', () => {
        const plan = buildStoryPlan(chain(3))!;
        const focus = resolveStoryFocus(plan, plan.steps[0].id);
        expect(focus?.nodeIds.has('n0')).toBe(true);
        expect(focus?.nodeIds.has('n2')).toBe(false);
    });

    it('returns null for a step that does not exist', () => {
        expect(resolveStoryFocus(buildStoryPlan(chain(3))!, 'no-such-step')).toBeNull();
    });

    it('resolves the primary path, and refuses when there is none', () => {
        expect(resolvePrimaryPathFocus(buildStoryPlan(chain(3))!)?.edgeIds.size).toBe(2);
        const single = buildStoryPlan(ir({ nodes: [{ id: 'a', label: 'A', kind: 'service' }] }))!;
        expect(resolvePrimaryPathFocus(single)).toBeNull();
    });
});

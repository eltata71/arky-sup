/**
 * Specs for the narrative walk.
 *
 * The scenes decide what a viewer is looking at, so the property that matters
 * is that dimming is *complete and reversible*: every node and edge carries an
 * explicit flag in both directions. A partial reset leaves the canvas
 * permanently half-faded, which reads as a rendering fault rather than as a
 * finished walk.
 */

import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import type { DiagramIR, DiagramNarrative } from '../../../lib/diagram';
import {
  MAX_NARRATIVE_SCENES,
  applyNarrativeFocus,
  buildNarrativeScenes,
  type NarrativeScene,
} from '../../../components/reactFlowCanvas/canvasNarrative';

const node = (id: string, extra: Partial<Node> = {}): Node =>
  ({ id, position: { x: 0, y: 0 }, data: { label: `Nodo ${id}` }, ...extra }) as Node;
const edge = (id: string, source: string, target: string): Edge => ({ id, source, target }) as Edge;

const chain = (length: number) => ({
  nodes: Array.from({ length }, (_, i) => node(`n${i}`)),
  edges: Array.from({ length: length - 1 }, (_, i) => edge(`e${i}`, `n${i}`, `n${i + 1}`)),
});

describe('building scenes', () => {
  it('produces a single scene for a graph with nothing to walk through', () => {
    expect(buildNarrativeScenes([node('a')], [])).toHaveLength(1);
    expect(buildNarrativeScenes([], [])).toHaveLength(1);
  });

  it('produces several scenes for a real graph', () => {
    expect(buildNarrativeScenes(...Object.values(chain(6)) as [Node[], Edge[]]).length).toBeGreaterThan(1);
  });

  it('never exceeds the cap, however large the graph', () => {
    // Past this a walk stops being a narrative and becomes a list.
    const { nodes, edges } = chain(60);
    expect(buildNarrativeScenes(nodes, edges).length).toBeLessThanOrEqual(MAX_NARRATIVE_SCENES);
  });

  it('ignores group zones, which are scenery rather than subject', () => {
    const scenes = buildNarrativeScenes(
      [node('a'), node('b'), node('zone', { type: 'groupZone' })],
      [edge('e', 'a', 'b')],
    );
    for (const scene of scenes) expect(scene.nodeIds.has('zone')).toBe(false);
  });

  it('ignores an edge whose endpoints are not both present', () => {
    const scenes = buildNarrativeScenes([node('a'), node('b')], [edge('e', 'a', 'ghost')]);
    for (const scene of scenes) expect(scene.edgeIds.has('e')).toBe(false);
  });

  it('gives every scene a title, so no step is unnamed', () => {
    const { nodes, edges } = chain(8);
    for (const scene of buildNarrativeScenes(nodes, edges)) {
      expect(scene.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('applying focus', () => {
  const nodes = [node('a'), node('b'), node('zone', { type: 'groupZone' })];
  const edges = [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')];
  const scene: NarrativeScene = {
    id: 's1',
    title: 'Primera',
    nodeIds: new Set(['a']),
    edgeIds: new Set(['e1']),
  };

  it('dims what is outside the scene and marks what is inside', () => {
    const focused = applyNarrativeFocus(nodes, edges, scene);
    const byId = new Map(focused.nodes.map((n) => [n.id, n.data as { isDimmed: boolean; isNarrativeFocus: boolean }]));
    expect(byId.get('a')).toMatchObject({ isDimmed: false, isNarrativeFocus: true });
    expect(byId.get('b')).toMatchObject({ isDimmed: true, isNarrativeFocus: false });
  });

  it('never dims a group zone — the scenery has to stay legible', () => {
    const focused = applyNarrativeFocus(nodes, edges, scene);
    const zone = focused.nodes.find((n) => n.id === 'zone');
    expect((zone!.data as { isDimmed: boolean }).isDimmed).toBe(false);
  });

  it('clears every flag when the walk ends', () => {
    // Reversibility is the point: a partial reset leaves the canvas
    // permanently half-faded, which looks like a fault, not an ending.
    const focused = applyNarrativeFocus(nodes, edges, scene);
    const cleared = applyNarrativeFocus(focused.nodes, focused.edges, null);
    for (const item of [...cleared.nodes, ...cleared.edges]) {
      expect(item.data).toMatchObject({ isDimmed: false, isNarrativeFocus: false });
    }
  });

  it('preserves the data already on a node', () => {
    const [focused] = applyNarrativeFocus([node('a', { data: { label: 'Nodo a', kind: 'Service' } })], [], scene).nodes;
    expect(focused.data).toMatchObject({ kind: 'Service', label: 'Nodo a' });
  });
});

describe('buildNarrativeScenes — the written story wins over the derived one', () => {
  const ir = (narrative: DiagramNarrative | undefined): DiagramIR => ({
    nodes: [
      { id: 'a', label: 'A', kind: 'service' },
      { id: 'b', label: 'B', kind: 'service' },
      { id: 'c', label: 'C', kind: 'service' },
    ],
    edges: [
      { id: 'e1', source: 'a', target: 'b', label: '' },
      { id: 'e2', source: 'b', target: 'c', label: '' },
    ],
    groups: [],
    metadata: { narrative },
  });

  const rf = () => ({
    nodes: [node('a'), node('b'), node('c')],
    edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
  });

  it('walks the authored scenes instead of the BFS levels', () => {
    const { nodes, edges } = rf();
    const scenes = buildNarrativeScenes(nodes, edges, ir({
      summary: 'La historia real.',
      scenes: [
        { id: 'authored-1', title: 'Todo a la vez', focusNodeIds: ['a', 'c'], focusEdgeIds: [] },
      ],
    }));
    expect(scenes[0]).toMatchObject({ id: 'authored-1', title: 'Todo a la vez' });
    expect(scenes[0].nodeIds).toEqual(new Set(['a', 'c']));
    // The overview is still appended: a guided walk that ends mid-diagram
    // leaves the reader looking at a fragment.
    expect(scenes.at(-1)?.id).toBe('scene-overview');
  });

  it('derives the walk when nobody wrote one', () => {
    const { nodes, edges } = rf();
    const derived = buildNarrativeScenes(nodes, edges, ir(undefined));
    expect(derived.map(scene => scene.id)).toEqual(buildNarrativeScenes(nodes, edges).map(scene => scene.id));
  });

  it('falls back to the derived walk when every authored id is stale', () => {
    const { nodes, edges } = rf();
    const scenes = buildNarrativeScenes(nodes, edges, ir({
      summary: 'Escrita contra un diagrama anterior.',
      scenes: [{ id: 'gone', title: 'Ya no existe', focusNodeIds: ['borrado'], focusEdgeIds: [] }],
    }));
    expect(scenes.some(scene => scene.id === 'gone')).toBe(false);
    expect(scenes.length).toBeGreaterThan(0);
  });

  it('behaves exactly as before when no IR is supplied', () => {
    const { nodes, edges } = rf();
    expect(buildNarrativeScenes(nodes, edges, null)).toEqual(buildNarrativeScenes(nodes, edges));
  });
});

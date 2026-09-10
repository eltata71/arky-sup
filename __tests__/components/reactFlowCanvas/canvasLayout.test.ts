/**
 * Specs for the canvas layout helpers.
 *
 * These ran only through a mounted canvas before, because they lived inside
 * `ReactFlowCanvas.tsx`. They are pure functions over ReactFlow's node and
 * edge shapes, and the behaviour that matters most in them is what they do
 * when the input is *wrong* — a missing position, a dangling edge, an empty
 * graph. Those are exactly the paths a rendering test reaches by accident, if
 * at all.
 */

import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import {
  materializeNodesOnVisibleGrid,
  prepareEdgesForInitialPaint,
  prepareNodesForInitialPaint,
  processEdges,
} from '../../../components/reactFlowCanvas/canvasLayout';

const node = (id: string, position?: { x: number; y: number }, extra: Partial<Node> = {}): Node => ({
  id,
  position: position as Node['position'],
  data: { label: `Nodo ${id}` },
  ...extra,
} as Node);

const edge = (id: string, source: string, target: string): Edge => ({ id, source, target } as Edge);

describe('preparing nodes for the first paint', () => {
  it('keeps a position the layout already produced', () => {
    const [prepared] = prepareNodesForInitialPaint([node('a', { x: 40, y: 80 })], 'standard');
    expect(prepared.position).toEqual({ x: 40, y: 80 });
  });

  it('places a node with no position on a grid rather than at the origin', () => {
    // The defect this guards: every unpositioned node stacking at (0,0)
    // renders as a single card with the rest invisible behind it — the
    // "empty canvas" symptom on C4 container diagrams.
    const prepared = prepareNodesForInitialPaint([node('a'), node('b'), node('c'), node('d')], 'standard');
    const positions = prepared.map((n) => `${n.position.x},${n.position.y}`);
    expect(new Set(positions).size).toBe(4);
    for (const n of prepared) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it('treats a non-finite position as no position at all', () => {
    const [prepared] = prepareNodesForInitialPaint([node('a', { x: NaN, y: 10 })], 'standard');
    expect(Number.isFinite(prepared.position.x)).toBe(true);
  });

  it('falls back to the id when a node carries no usable label', () => {
    const prepared = prepareNodesForInitialPaint(
      [node('a', { x: 0, y: 0 }, { data: { label: '   ' } }), node('b', { x: 0, y: 0 }, { data: {} })],
      'standard',
    );
    // A blank label renders as a nameless box, which is worse than a raw id.
    expect((prepared[0].data as { label: string }).label).toBe('a');
    expect((prepared[1].data as { label: string }).label).toBe('b');
  });

  it('carries the density through to every node', () => {
    const prepared = prepareNodesForInitialPaint([node('a', { x: 0, y: 0 })], 'compact');
    expect((prepared[0].data as { density: string }).density).toBe('compact');
  });

  it('survives an empty or absent list', () => {
    expect(prepareNodesForInitialPaint([], 'standard')).toEqual([]);
    expect(prepareNodesForInitialPaint(undefined as unknown as Node[], 'standard')).toEqual([]);
  });
});

describe('materialising nodes on the visible grid', () => {
  it('repositions everything, ignoring the layout', () => {
    const materialised = materializeNodesOnVisibleGrid([node('a', { x: 999, y: 999 }), node('b', { x: 5, y: 5 })], 'standard');
    expect(materialised[0].position).not.toEqual({ x: 999, y: 999 });
    expect(new Set(materialised.map((n) => `${n.position.x},${n.position.y}`)).size).toBe(2);
  });

  it('drops group zones, which have no meaning without their cluster', () => {
    const materialised = materializeNodesOnVisibleGrid(
      [node('a', { x: 0, y: 0 }), node('zone', { x: 0, y: 0 }, { type: 'groupZone' })],
      'standard',
    );
    expect(materialised.map((n) => n.id)).toEqual(['a']);
  });
});

describe('preparing edges for the first paint', () => {
  const ids = new Set(['a', 'b']);

  it('keeps an edge whose endpoints both exist', () => {
    expect(prepareEdgesForInitialPaint([edge('e1', 'a', 'b')], ids)).toHaveLength(1);
  });

  it('drops a dangling edge instead of letting ReactFlow throw', () => {
    expect(prepareEdgesForInitialPaint([edge('e1', 'a', 'ghost')], ids)).toEqual([]);
    expect(prepareEdgesForInitialPaint([edge('e2', 'ghost', 'b')], ids)).toEqual([]);
  });

  it('synthesises an id when the edge has none', () => {
    const [prepared] = prepareEdgesForInitialPaint([{ source: 'a', target: 'b' } as Edge], ids);
    expect(prepared.id).toBe('edge-a-b');
  });
});

describe('processing edge styles', () => {
  it('gives every edge a marker and a label', () => {
    const [processed] = processEdges([edge('e1', 'a', 'b')]);
    expect(processed.type).toBe('custom');
    expect(processed.markerEnd).toBeTruthy();
    // An unlabelled relation reads as an accident; "Relaciona" reads as a
    // relation whose kind was not specified.
    expect(processed.label).toBe('Relaciona');
  });

  it('keeps a marker the canonical pipeline already chose', () => {
    const custom = { ...edge('e1', 'a', 'b'), markerEnd: 'url(#custom)' } as Edge;
    expect(processEdges([custom])[0].markerEnd).toBe('url(#custom)');
  });

  it('keeps a real label', () => {
    expect(processEdges([{ ...edge('e1', 'a', 'b'), label: 'consulta' } as Edge])[0].label).toBe('consulta');
  });

  it('assigns label slots so parallel edges fan out instead of stacking', () => {
    const processed = processEdges([edge('e1', 'a', 'b'), edge('e2', 'a', 'b'), edge('e3', 'a', 'b')]);
    const slots = processed.map((e) => (e.data as { labelSlot?: number }).labelSlot);
    expect(new Set(slots).size).toBeGreaterThan(1);
  });
});

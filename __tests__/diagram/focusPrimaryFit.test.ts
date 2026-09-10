import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';
import { computeFocalBoundingBox, pickPrimaryFocus } from '../../services/diagram/focusPrimaryFit';

const node = (id: string, data: Record<string, unknown> = {}, position = { x: 0, y: 0 }): Node => ({
  id,
  type: 'custom',
  position,
  data: { label: id, ...data },
});

const edge = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
  data: {},
});

describe('focusPrimaryFit / pickPrimaryFocus', () => {
  it('returns empty when there are no content nodes', () => {
    const result = pickPrimaryFocus([], []);
    expect(result.focalIds.size).toBe(0);
    expect(result.rationale).toBe('empty');
  });

  it('returns every node when the graph is small (<=4)', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const result = pickPrimaryFocus(nodes, []);
    expect(result.focalIds.size).toBe(3);
    expect(result.rationale).toBe('single-hub');
  });

  it('skips groupZone nodes when computing focus', () => {
    const nodes = [
      { ...node('zone'), type: 'groupZone' } as Node,
      node('a'),
      node('b'),
    ];
    const result = pickPrimaryFocus(nodes, []);
    expect(result.focalIds.has('zone')).toBe(false);
    expect(result.focalIds.has('a')).toBe(true);
  });

  it('prefers explicit hierarchy hints when present', () => {
    const nodes = [
      node('hub', { hierarchyLevel: 'focal' }),
      node('api', { hierarchyLevel: 'primary' }),
      node('queue', { hierarchyLevel: 'supporting' }),
      node('legacy', { hierarchyLevel: 'external' }),
      node('logs', { hierarchyLevel: 'secondary' }),
      node('audit', { hierarchyLevel: 'supporting' }),
    ];
    const result = pickPrimaryFocus(nodes, []);
    expect(result.rationale).toBe('hierarchy-hints');
    expect(result.focalIds.has('hub')).toBe(true);
    expect(result.focalIds.has('api')).toBe(true);
    expect(result.focalIds.has('queue')).toBe(false);
  });

  it('treats critical nodes as focal even without a hierarchy hint', () => {
    const nodes = [
      node('payments', { criticality: 'critical' }),
      node('reports', { criticality: 'low' }),
      node('users'),
      node('emails'),
      node('audit'),
      node('webhooks'),
    ];
    const result = pickPrimaryFocus(nodes, []);
    expect(result.focalIds.has('payments')).toBe(true);
    expect(result.focalIds.has('reports')).toBe(false);
  });

  it('falls back to centrality when no hints are present', () => {
    const nodes = [
      node('hub'),
      node('a'),
      node('b'),
      node('c'),
      node('d'),
      node('isolated'),
    ];
    // hub is connected to a/b/c/d (degree 4); others have degree 1; isolated has 0.
    const edges = [
      edge('e1', 'hub', 'a'),
      edge('e2', 'hub', 'b'),
      edge('e3', 'hub', 'c'),
      edge('e4', 'hub', 'd'),
    ];
    const result = pickPrimaryFocus(nodes, edges);
    expect(result.rationale).toBe('centrality');
    expect(result.focalIds.has('hub')).toBe(true);
    expect(result.focalIds.has('isolated')).toBe(false);
  });

  it('caps the focus set to a meaningful fraction of the graph', () => {
    const nodes = Array.from({ length: 20 }, (_, i) => node(`n${i}`));
    const edges = Array.from({ length: 19 }, (_, i) => edge(`e${i}`, `n0`, `n${i + 1}`));
    const result = pickPrimaryFocus(nodes, edges);
    expect(result.focalIds.size).toBeLessThanOrEqual(Math.ceil(20 * 0.4));
    expect(result.focalIds.has('n0')).toBe(true);
  });
});

describe('focusPrimaryFit / computeFocalBoundingBox', () => {
  it('returns null when no focal nodes match', () => {
    const nodes = [node('a', {}, { x: 0, y: 0 })];
    expect(computeFocalBoundingBox(nodes, new Set(['missing']))).toBeNull();
  });

  it('produces a bounding box that covers all focal nodes', () => {
    const nodes = [
      { ...node('a', {}, { x: 0, y: 0 }), width: 100, height: 50 } as Node,
      { ...node('b', {}, { x: 200, y: 100 }), width: 100, height: 50 } as Node,
      { ...node('c', {}, { x: -50, y: -20 }), width: 80, height: 40 } as Node,
    ];
    const bbox = computeFocalBoundingBox(nodes, new Set(['a', 'b']));
    expect(bbox).not.toBeNull();
    expect(bbox!.x).toBe(0);
    expect(bbox!.y).toBe(0);
    expect(bbox!.width).toBe(300);
    expect(bbox!.height).toBe(150);
  });

  it('ignores nodes with non-finite positions', () => {
    const nodes = [
      { ...node('a', {}, { x: Number.NaN, y: 0 }), width: 100, height: 50 } as Node,
      { ...node('b', {}, { x: 200, y: 100 }), width: 100, height: 50 } as Node,
    ];
    const bbox = computeFocalBoundingBox(nodes, new Set(['a', 'b']));
    expect(bbox).not.toBeNull();
    expect(bbox!.x).toBe(200);
  });
});

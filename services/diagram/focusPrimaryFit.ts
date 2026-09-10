import type { Node, Edge } from 'reactflow';

/**
 * Pick the "primary" subset of nodes for a focus-on-essentials viewport.
 *
 * Rationale (Mejoras 2/3/6): when a diagram is too sprawling to read at a
 * legible zoom, "Ver todo" sacrifices readability. A focus-primary mode dims
 * supporting/external nodes and zooms to the focal subset, so executives can
 * read the essential story without losing the option to explore the rest.
 *
 * The picker is intentionally non-AI and cheap: it combines explicit
 * hierarchy hints (when present on `node.data.hierarchyLevel` or
 * `node.data.criticality`) with a graph-centrality fallback (degree). It
 * never returns an empty set: a single hub is always better than no focal
 * subset.
 */

export interface FocusPrimaryNodeHint {
  hierarchyLevel?: 'focal' | 'primary' | 'secondary' | 'supporting' | 'external' | 'risk';
  criticality?: 'low' | 'medium' | 'high' | 'critical' | string;
  semanticRole?: string;
}

export interface FocusPrimaryResult {
  focalIds: Set<string>;
  rationale: 'hierarchy-hints' | 'centrality' | 'single-hub' | 'empty';
}

const HIGH_PRIORITY_HIERARCHY = new Set(['focal', 'primary', 'risk']);
const HIGH_PRIORITY_CRITICALITY = new Set(['high', 'critical']);

const readHint = (node: Node): FocusPrimaryNodeHint => {
  const data = (node.data ?? {}) as Record<string, unknown>;
  return {
    hierarchyLevel: typeof data.hierarchyLevel === 'string' ? (data.hierarchyLevel as FocusPrimaryNodeHint['hierarchyLevel']) : undefined,
    criticality: typeof data.criticality === 'string' ? data.criticality : undefined,
    semanticRole: typeof data.semanticRole === 'string' ? data.semanticRole : undefined,
  };
};

const isContentNode = (node: Node): boolean => node.type !== 'groupZone';

export function pickPrimaryFocus(nodes: Node[], edges: Edge[]): FocusPrimaryResult {
  const content = nodes.filter(isContentNode);
  if (content.length === 0) return { focalIds: new Set(), rationale: 'empty' };
  if (content.length <= 4) return { focalIds: new Set(content.map((n) => String(n.id))), rationale: 'single-hub' };

  // Pass 1 — explicit hierarchy / criticality hints win when available.
  const hintFocal = new Set<string>();
  for (const node of content) {
    const hint = readHint(node);
    const byHierarchy = hint.hierarchyLevel ? HIGH_PRIORITY_HIERARCHY.has(hint.hierarchyLevel) : false;
    const byCriticality = hint.criticality ? HIGH_PRIORITY_CRITICALITY.has(hint.criticality) : false;
    if (byHierarchy || byCriticality) hintFocal.add(String(node.id));
  }
  if (hintFocal.size > 0) {
    // Cap so we never collapse the whole diagram to "focal".
    const cap = Math.max(3, Math.ceil(content.length * 0.45));
    if (hintFocal.size <= cap) return { focalIds: hintFocal, rationale: 'hierarchy-hints' };
  }

  // Pass 2 — centrality: pick nodes with above-mean (in + out) degree.
  const degree = new Map<string, number>();
  for (const n of content) degree.set(String(n.id), 0);
  for (const e of edges) {
    const s = String(e.source);
    const t = String(e.target);
    if (degree.has(s)) degree.set(s, (degree.get(s) ?? 0) + 1);
    if (degree.has(t)) degree.set(t, (degree.get(t) ?? 0) + 1);
  }
  const degrees = Array.from(degree.values());
  const mean = degrees.reduce((a, b) => a + b, 0) / Math.max(1, degrees.length);
  const focal = new Set<string>();
  for (const [id, d] of degree.entries()) {
    if (d >= mean && d > 0) focal.add(id);
  }
  if (focal.size === 0) {
    // No edges or all isolated: fall back to the first node (a single hub).
    focal.add(String(content[0].id));
    return { focalIds: focal, rationale: 'single-hub' };
  }
  // Cap to ~40% of the graph so the focus stays meaningful even on hub-heavy graphs.
  const cap = Math.max(3, Math.ceil(content.length * 0.4));
  if (focal.size > cap) {
    const sorted = Array.from(degree.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, cap)
      .map(([id]) => id);
    return { focalIds: new Set(sorted), rationale: 'centrality' };
  }
  return { focalIds: focal, rationale: 'centrality' };
}

export interface FocalBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_FALLBACK_WIDTH = 220;
const NODE_FALLBACK_HEIGHT = 110;

export function computeFocalBoundingBox(nodes: Node[], focalIds: Set<string>): FocalBoundingBox | null {
  if (focalIds.size === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let counted = 0;
  for (const node of nodes) {
    if (!focalIds.has(String(node.id))) continue;
    const x = node.position?.x;
    const y = node.position?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const w = node.width ?? NODE_FALLBACK_WIDTH;
    const h = node.height ?? NODE_FALLBACK_HEIGHT;
    minX = Math.min(minX, x as number);
    minY = Math.min(minY, y as number);
    maxX = Math.max(maxX, (x as number) + w);
    maxY = Math.max(maxY, (y as number) + h);
    counted++;
  }
  if (counted === 0) return null;
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/**
 * Geometric edge-anchor assignment.
 *
 * ReactFlow anchors an edge to the FIRST handle of each type when the edge
 * does not specify `sourceHandle` / `targetHandle`. With multi-handle nodes
 * this collapses every connection of a hub node onto one point, producing
 * the "starburst" of long curves sweeping across the canvas seen in the
 * field screenshots.
 *
 * This pass picks, per edge, the handle on the side of each node that faces
 * the other endpoint (dominant axis of the center-to-center vector), so
 * edges leave and enter nodes naturally in any layout direction. It runs on
 * final positions — after layout, after group separation and after manual
 * drags — and is pure/deterministic for easy testing.
 *
 * Handle id contract (must match CustomNode): sources `s-top|s-bottom|
 * s-left|s-right`, targets `t-top|t-bottom|t-left|t-right`.
 */

export interface AnchorNode {
    id: string;
    position?: { x: number; y: number };
    width?: number | null;
    height?: number | null;
    data?: { width?: number; height?: number } | Record<string, unknown>;
    type?: string;
}

export interface AnchorEdge {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
}

const FALLBACK_W = 260;
const FALLBACK_H = 160;

type Side = 'top' | 'bottom' | 'left' | 'right';

function centerOf(node: AnchorNode): { x: number; y: number } | null {
    const x = node.position?.x;
    const y = node.position?.y;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const data = (node.data ?? {}) as { width?: number; height?: number };
    const w = (Number.isFinite(data.width) && (data.width as number) > 0 ? data.width as number : null)
        ?? (Number.isFinite(node.width as number) && (node.width as number) > 0 ? node.width as number : null)
        ?? FALLBACK_W;
    const h = (Number.isFinite(data.height) && (data.height as number) > 0 ? data.height as number : null)
        ?? (Number.isFinite(node.height as number) && (node.height as number) > 0 ? node.height as number : null)
        ?? FALLBACK_H;
    return { x: (x as number) + w / 2, y: (y as number) + h / 2 };
}

/** Side of the SOURCE node facing the target (and its mirror for the target). */
export function pickSides(source: { x: number; y: number }, target: { x: number; y: number }): { sourceSide: Side; targetSide: Side } {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0
            ? { sourceSide: 'right', targetSide: 'left' }
            : { sourceSide: 'left', targetSide: 'right' };
    }
    return dy >= 0
        ? { sourceSide: 'bottom', targetSide: 'top' }
        : { sourceSide: 'top', targetSide: 'bottom' };
}

/**
 * Return the edges with `sourceHandle` / `targetHandle` assigned from the
 * node geometry. Edges whose endpoints lack finite positions are returned
 * untouched (ReactFlow falls back to its default anchoring). Existing
 * handle assignments are always recomputed — positions are the truth.
 */
export function assignEdgeAnchors<TEdge extends AnchorEdge>(
    nodes: AnchorNode[],
    edges: TEdge[],
): TEdge[] {
    const centers = new Map<string, { x: number; y: number }>();
    for (const node of nodes) {
        if (node.type === 'groupZone') continue;
        const center = centerOf(node);
        if (center) centers.set(String(node.id), center);
    }
    if (centers.size === 0) return edges;
    let mutated = false;
    const next = edges.map((edge) => {
        const src = centers.get(String(edge.source));
        const tgt = centers.get(String(edge.target));
        if (!src || !tgt) return edge;
        const { sourceSide, targetSide } = pickSides(src, tgt);
        const sourceHandle = `s-${sourceSide}`;
        const targetHandle = `t-${targetSide}`;
        if (edge.sourceHandle === sourceHandle && edge.targetHandle === targetHandle) return edge;
        mutated = true;
        return { ...edge, sourceHandle, targetHandle };
    });
    return mutated ? next : edges;
}

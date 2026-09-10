/**
 * Deterministic post-layout pass that removes overlaps between group
 * clusters (the translucent "group zone" rectangles drawn behind grouped
 * nodes).
 *
 * Why it exists: the compound dagre layout keeps each group's members
 * contiguous, but the ELK path and the legacy canvas re-layout don't model
 * clusters, so two groups can land on intersecting bounding boxes — exactly
 * the overlapping translucent containers visible in the field screenshots
 * (integration / data-flow diagrams). This pass translates whole clusters
 * apart along the axis of least displacement, preserving each cluster's
 * internal geometry, until no two zones intersect.
 *
 * Pure function over plain rect data so it is renderer-agnostic and easy to
 * unit test; the canvas adapter lives next to the ReactFlow component.
 */

export interface SeparationNode {
    id: string;
    /** Group label this node belongs to; ungrouped nodes are never moved. */
    group?: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface GroupSeparationOptions {
    /** Padding the zone renderer adds around member nodes (per side). */
    zonePadding?: number;
    /** Extra clearance required between two zones after separation. */
    gap?: number;
    /** Safety cap on the resolution loop. */
    maxIterations?: number;
}

const DEFAULTS: Required<GroupSeparationOptions> = {
    zonePadding: 44,
    gap: 32,
    maxIterations: 24,
};

interface ClusterRect {
    group: string;
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

function buildClusterRects(nodes: SeparationNode[], padding: number): Map<string, ClusterRect> {
    const clusters = new Map<string, ClusterRect>();
    for (const node of nodes) {
        if (!node.group) continue;
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
        const rect = clusters.get(node.group);
        const minX = node.x - padding;
        const minY = node.y - padding;
        const maxX = node.x + node.width + padding;
        const maxY = node.y + node.height + padding;
        if (!rect) {
            clusters.set(node.group, { group: node.group, minX, minY, maxX, maxY });
        } else {
            rect.minX = Math.min(rect.minX, minX);
            rect.minY = Math.min(rect.minY, minY);
            rect.maxX = Math.max(rect.maxX, maxX);
            rect.maxY = Math.max(rect.maxY, maxY);
        }
    }
    return clusters;
}

function overlapAmount(a: ClusterRect, b: ClusterRect, gap: number): { x: number; y: number } | null {
    const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) + gap;
    const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY) + gap;
    if (overlapX <= 0 || overlapY <= 0) return null;
    return { x: overlapX, y: overlapY };
}

/**
 * Compute per-group translation offsets that resolve every zone-vs-zone
 * overlap. Returns an empty map when the layout is already clean, so callers
 * can cheaply skip the node rewrite.
 */
export function computeGroupSeparationOffsets(
    nodes: SeparationNode[],
    options: GroupSeparationOptions = {},
): Map<string, { dx: number; dy: number }> {
    const opts = { ...DEFAULTS, ...options };
    const offsets = new Map<string, { dx: number; dy: number }>();
    const clusters = buildClusterRects(nodes, opts.zonePadding);
    if (clusters.size < 2) return offsets;

    // Stable order keeps the pass deterministic regardless of Map insertion.
    const order = Array.from(clusters.values()).sort((a, b) => a.group.localeCompare(b.group));

    for (let iter = 0; iter < opts.maxIterations; iter++) {
        let moved = false;
        for (let i = 0; i < order.length; i++) {
            for (let j = i + 1; j < order.length; j++) {
                const a = order[i];
                const b = order[j];
                const overlap = overlapAmount(a, b, opts.gap);
                if (!overlap) continue;
                moved = true;
                // Push apart along the axis needing the smaller shift; split
                // the displacement between both clusters so the diagram's
                // centroid stays roughly in place.
                if (overlap.x <= overlap.y) {
                    const dir = (a.minX + a.maxX) / 2 <= (b.minX + b.maxX) / 2 ? 1 : -1;
                    const half = (overlap.x / 2) * dir;
                    shiftCluster(a, offsets, -half, 0);
                    shiftCluster(b, offsets, half, 0);
                } else {
                    const dir = (a.minY + a.maxY) / 2 <= (b.minY + b.maxY) / 2 ? 1 : -1;
                    const half = (overlap.y / 2) * dir;
                    shiftCluster(a, offsets, 0, -half);
                    shiftCluster(b, offsets, 0, half);
                }
            }
        }
        if (!moved) break;
    }

    // Drop zero-offsets so callers can use `offsets.size === 0` as a no-op check.
    for (const [group, off] of Array.from(offsets.entries())) {
        if (Math.abs(off.dx) < 0.5 && Math.abs(off.dy) < 0.5) offsets.delete(group);
    }
    return offsets;
}

function shiftCluster(
    rect: ClusterRect,
    offsets: Map<string, { dx: number; dy: number }>,
    dx: number,
    dy: number,
): void {
    rect.minX += dx;
    rect.maxX += dx;
    rect.minY += dy;
    rect.maxY += dy;
    const current = offsets.get(rect.group) ?? { dx: 0, dy: 0 };
    offsets.set(rect.group, { dx: current.dx + dx, dy: current.dy + dy });
}

/**
 * Convenience wrapper: returns the nodes with cluster offsets applied.
 * Ungrouped nodes and nodes in non-overlapping groups come back untouched
 * (same object references) so React reconciliation stays cheap.
 */
export function separateGroupClusters<T extends SeparationNode>(
    nodes: T[],
    options: GroupSeparationOptions = {},
): T[] {
    const offsets = computeGroupSeparationOffsets(nodes, options);
    if (offsets.size === 0) return nodes;
    return nodes.map((node) => {
        const off = node.group ? offsets.get(node.group) : undefined;
        if (!off) return node;
        return { ...node, x: node.x + off.dx, y: node.y + off.dy };
    });
}

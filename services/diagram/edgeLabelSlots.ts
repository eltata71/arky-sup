/**
 * Edge-label slot assignment for parallel edges.
 *
 * When two or more edges connect the same pair of nodes (in either
 * direction) ReactFlow renders every label at the path midpoint, stacking
 * them into an unreadable pile. This module assigns each edge of a parallel
 * bundle a stable slot index so `CustomEdge` can fan the labels out along a
 * small perpendicular ladder.
 *
 * Pure data pass — works on anything that has `source`/`target` — so both
 * the canonical IR pipeline (`irToReactFlow`) and the legacy canvas path
 * (`prepareEdgesForInitialPaint`) can share it.
 */

export interface EdgeLabelSlot {
    /** 0-based position of this edge inside its parallel bundle. */
    index: number;
    /** Total number of edges sharing the same (unordered) node pair. */
    count: number;
}

/** Unordered pair key: A→B and B→A share the same label ladder. */
function pairKey(source: string, target: string): string {
    return source <= target ? `${source}::${target}` : `${target}::${source}`;
}

/**
 * Compute the label slot for every edge. Edges that are alone on their node
 * pair get `{ index: 0, count: 1 }` so renderers can skip the offset math.
 * Assignment order follows the input order, which is stable across renders
 * because both pipelines emit edges in IR order.
 */
export function computeEdgeLabelSlots(
    edges: Array<{ id: string; source: string; target: string }>,
): Map<string, EdgeLabelSlot> {
    const counts = new Map<string, number>();
    for (const edge of edges) {
        const key = pairKey(String(edge.source), String(edge.target));
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const cursor = new Map<string, number>();
    const slots = new Map<string, EdgeLabelSlot>();
    for (const edge of edges) {
        const key = pairKey(String(edge.source), String(edge.target));
        const index = cursor.get(key) ?? 0;
        cursor.set(key, index + 1);
        slots.set(String(edge.id), { index, count: counts.get(key) ?? 1 });
    }
    return slots;
}

/**
 * Perpendicular pixel offset for a slot: centred ladder with `step` px
 * between rungs ( … -1, 0, +1 … of the centre). A single edge yields 0.
 */
export function slotOffsetPx(slot: EdgeLabelSlot | undefined, step = 26): number {
    if (!slot || slot.count <= 1) return 0;
    return (slot.index - (slot.count - 1) / 2) * step;
}

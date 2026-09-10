/**
 * Narrative scenes — the guided walk through a diagram.
 *
 * Splits a graph into an ordered set of scenes and dims everything outside the
 * one being shown. Pure over `Node`/`Edge`, so it belongs beside the layout
 * rather than inside the component that renders it.
 *
 * **The written story wins.** This module used to derive every scene from BFS
 * levels, including for diagrams that carried an authored narrative in their
 * IR — so story mode replayed a plausible sequence and threw away the real
 * one. It now takes an optional `StoryPlan` and walks that when the plan was
 * authored; the derivation is what happens when nobody wrote a story, which is
 * most of the time and is exactly when a topological order is the honest
 * answer. The distinction is the plan's own `source`, never guessed here.
 *
 * The plan is built here rather than memoised in the canvas on purpose: it is
 * O(V+E) over an IR the caller already holds, it only runs when a layout pass
 * completes, and keeping it here is what stops a 1.900-line component from
 * growing a second derivation of the same thing.
 */

import type { Edge, Node } from 'reactflow';

import type { DiagramIR } from '../../lib/diagram';
import type { StoryPlan } from '../../lib/diagram/storyPlan';
import { buildStoryPlan } from '../../services/diagram';

/** A step of the guided walk: a title and the ids it brings into focus. */
export interface NarrativeScene {
    id: string;
    title: string;
    nodeIds: Set<string>;
    edgeIds: Set<string>;
}

/** Beyond this the walk stops being a narrative and becomes a list. */
export const MAX_NARRATIVE_SCENES = 12;

/**
 * Turn an authored plan into the walk, keeping only ids the canvas actually
 * holds. A final overview scene is appended for the same reason the derived
 * walk has one: a guided reading that ends mid-diagram leaves the reader
 * looking at a fragment.
 */
const scenesFromPlan = (plan: StoryPlan, nodes: Node[], edges: Edge[]): NarrativeScene[] => {
    const contentNodes = nodes.filter(n => n.type !== 'groupZone');
    const contentNodeIds = new Set(contentNodes.map(n => n.id));
    const validEdges = edges.filter(e => contentNodeIds.has(e.source) && contentNodeIds.has(e.target));
    const edgeIds = new Set(validEdges.map(e => e.id));

    const scenes = plan.steps
        .map(step => ({
            id: step.id,
            title: step.title,
            nodeIds: new Set(step.nodeIds.filter(id => contentNodeIds.has(id))),
            edgeIds: new Set(step.edgeIds.filter(id => edgeIds.has(id))),
        }))
        .filter(scene => scene.nodeIds.size > 0)
        .slice(0, MAX_NARRATIVE_SCENES - 1);

    if (scenes.length === 0) return [];

    scenes.push({
        id: 'scene-overview',
        title: 'Vista completa',
        nodeIds: new Set(contentNodes.map(n => n.id)),
        edgeIds: new Set(validEdges.map(e => e.id)),
    });
    return scenes;
};

export const buildNarrativeScenes = (nodes: Node[], edges: Edge[], ir?: DiagramIR | null): NarrativeScene[] => {
    const plan = ir ? buildStoryPlan(ir) : null;
    if (plan?.source === 'authored') {
        const authored = scenesFromPlan(plan, nodes, edges);
        // An authored plan whose ids no longer resolve is not a story about
        // this diagram. Falling through to the derivation beats showing an
        // empty walk, and `StoryPlan.unresolvedReferences` is what says why.
        if (authored.length > 0) return authored;
    }

    const contentNodes = nodes.filter(n => n.type !== 'groupZone');
    const contentNodeIds = new Set(contentNodes.map(n => n.id));
    const validEdges = edges.filter(e => contentNodeIds.has(e.source) && contentNodeIds.has(e.target));

    if (contentNodes.length <= 1) {
        return [{
            id: 'scene-1',
            title: 'Vista general',
            nodeIds: new Set(contentNodes.map(n => n.id)),
            edgeIds: new Set(validEdges.map(e => e.id)),
        }];
    }

    const incoming = new Map<string, number>();
    const outgoing = new Map<string, Set<string>>();
    contentNodes.forEach(n => {
        incoming.set(n.id, 0);
        outgoing.set(n.id, new Set<string>());
    });
    validEdges.forEach(e => {
        incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
        outgoing.get(e.source)?.add(e.target);
    });

    const levels = new Map<string, number>();
    const queue: string[] = [];
    const seedTraversal = (seedIds: string[], seedLevel: number) => {
        seedIds.forEach(id => {
            if (!contentNodeIds.has(id) || levels.has(id)) return;
            levels.set(id, seedLevel);
            queue.push(id);
        });

        for (let idx = 0; idx < queue.length; idx++) {
            const sourceId = queue[idx];
            const sourceLevel = levels.get(sourceId) ?? seedLevel;
            (outgoing.get(sourceId) ?? new Set<string>()).forEach(targetId => {
                // A generated architecture can contain feedback loops (A → B → A).
                // Narrative mode only needs one stable level per node; revisiting
                // already-levelled nodes caused unbounded queue growth and surfaced
                // as a browser-level `Invalid array length` crash.
                if (levels.has(targetId)) return;
                levels.set(targetId, sourceLevel + 1);
                queue.push(targetId);
            });
        }
        queue.length = 0;
    };

    const roots = contentNodes
        .filter(n => (incoming.get(n.id) ?? 0) === 0)
        .map(n => n.id);
    seedTraversal(roots.length > 0 ? roots : [contentNodes[0].id], 0);

    // Cover disconnected components and fully-cyclic islands that have no root.
    contentNodes.forEach(node => {
        if (!levels.has(node.id)) seedTraversal([node.id], 0);
    });

    const levelValues = Array.from(levels.values()).filter(Number.isFinite);
    const maxLevel = Math.min(
        levelValues.length > 0 ? Math.max(...levelValues) : 0,
        Math.max(0, contentNodes.length - 1),
        MAX_NARRATIVE_SCENES - 2,
    );
    const scenes: NarrativeScene[] = [];
    for (let level = 0; level <= maxLevel; level++) {
        const isLastNarrativeLevel = level === maxLevel;
        const levelNodeIds = contentNodes
            .filter(n => {
                const nodeLevel = levels.get(n.id) ?? 0;
                return isLastNarrativeLevel ? nodeLevel >= level : nodeLevel === level;
            })
            .map(n => n.id);
        if (levelNodeIds.length === 0) continue;
        const levelSet = new Set(levelNodeIds);
        const edgeSet = new Set(
            validEdges
                .filter(e => levelSet.has(e.source) || levelSet.has(e.target))
                .map(e => e.id)
        );
        scenes.push({
            id: `scene-${level + 1}`,
            title: isLastNarrativeLevel && Array.from(levels.values()).some(value => value > level)
                ? `Paso ${level + 1}+`
                : `Paso ${level + 1}`,
            nodeIds: levelSet,
            edgeIds: edgeSet,
        });
    }

    scenes.push({
        id: 'scene-overview',
        title: 'Vista completa',
        nodeIds: new Set(contentNodes.map(n => n.id)),
        edgeIds: new Set(validEdges.map(e => e.id)),
    });

    return scenes;
};

export const applyNarrativeFocus = (
    nodes: Node[],
    edges: Edge[],
    scene: NarrativeScene | null,
): { nodes: Node[]; edges: Edge[] } => {
    if (!scene) {
        return {
            nodes: nodes.map(node => ({
                ...node,
                data: { ...(node.data ?? {}), isDimmed: false, isNarrativeFocus: false },
            })),
            edges: edges.map(edge => ({
                ...edge,
                data: { ...(edge.data ?? {}), isDimmed: false, isNarrativeFocus: false },
            })),
        };
    }

    return {
        nodes: nodes.map(node => ({
            ...node,
            data: {
                ...(node.data ?? {}),
                isDimmed: node.type === 'groupZone' ? false : !scene.nodeIds.has(node.id),
                isNarrativeFocus: scene.nodeIds.has(node.id),
            },
        })),
        edges: edges.map(edge => ({
            ...edge,
            data: {
                ...(edge.data ?? {}),
                isDimmed: !scene.edgeIds.has(edge.id),
                isNarrativeFocus: scene.edgeIds.has(edge.id),
            },
        })),
    };
};

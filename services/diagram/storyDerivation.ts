/**
 * Deriving a story from the graph, for the diagrams nobody wrote one for.
 *
 * This is the half of the planner that runs when there is nothing to honour:
 * where a reader starts, in what order the nodes come, which route the diagram
 * is mainly about, and what must not be missed. It is a separate module from
 * `storyPlanner` because the two answer different questions — this one *guesses
 * well*, and the planner decides whether a guess is what the caller is getting
 * and says so in `StoryPlan.source`. Keeping them in one file also put it over
 * its byte ceiling, which is the usual sign that a file is holding two jobs.
 *
 * Pure and model-free. Everything here is derivable from the graph, and
 * spending a call on something an algorithm decides reliably is the trade this
 * codebase refuses everywhere else.
 */

import type { DiagramIR, DiagramIREdge, DiagramIRNode } from '../../lib/diagram';
import type { StoryHotspot, StoryHotspotKind, StoryPath, StoryStep } from '../../lib/diagram/storyPlan';
import { detectSemanticRole } from '../../lib/diagramTokens';

/** Beyond this a guided walk stops being a story and becomes a list. */
export const MAX_STORY_STEPS = 12;

/** Beyond this the highlights stop highlighting anything. */
export const MAX_STORY_HOTSPOTS = 8;

const CRITICALITY_WEIGHT: Record<string, number> = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};

const SENSITIVE_CLASSIFICATIONS = new Set(['pii', 'phi', 'pci', 'restricted']);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/* ------------------------------------------------------------------ *
 * Hotspots — the same rule for both sources.
 * ------------------------------------------------------------------ */

const nodeHotspotKind = (node: DiagramIRNode): { kind: StoryHotspotKind; severity: StoryHotspot['severity']; text: string } | null => {
    if (node.status === 'error') {
        return { kind: 'failure', severity: 'critical', text: `${node.label}: en estado de error.` };
    }
    if (node.securityLevel === 'critical') {
        return { kind: 'security', severity: 'critical', text: `${node.label}: zona de seguridad crítica.` };
    }
    if (node.dataClassification && SENSITIVE_CLASSIFICATIONS.has(node.dataClassification)) {
        return {
            kind: 'sensitive-data',
            severity: 'warning',
            text: `${node.label}: trata datos ${node.dataClassification.toUpperCase()}.`,
        };
    }
    if (node.criticality === 'critical') {
        return { kind: 'risk', severity: 'critical', text: `${node.label}: criticidad de negocio crítica.` };
    }
    if (node.status === 'warning') {
        return { kind: 'risk', severity: 'warning', text: `${node.label}: requiere atención.` };
    }
    if (node.criticality === 'high' || node.securityLevel === 'elevated') {
        return { kind: 'risk', severity: 'warning', text: `${node.label}: criticidad alta.` };
    }
    return null;
};

const edgeHotspotKind = (edge: DiagramIREdge): { kind: StoryHotspotKind; severity: StoryHotspot['severity']; text: string } | null => {
    const name = text(edge.label) || `${edge.source} → ${edge.target}`;
    if (edge.criticality === 'critical') {
        return { kind: 'risk', severity: 'critical', text: `${name}: interacción crítica del flujo.` };
    }
    if (edge.dataSensitivity && SENSITIVE_CLASSIFICATIONS.has(edge.dataSensitivity)) {
        return {
            kind: 'sensitive-data',
            severity: 'warning',
            text: `${name}: transporta datos ${edge.dataSensitivity.toUpperCase()}.`,
        };
    }
    return null;
};

const severityRank: Record<StoryHotspot['severity'], number> = { critical: 0, warning: 1, info: 2 };

export const collectHotspots = (ir: DiagramIR): StoryHotspot[] => {
    const found: StoryHotspot[] = [];
    for (const node of ir.nodes) {
        const hit = nodeHotspotKind(node);
        if (hit) {
            found.push({ id: `hotspot-node-${node.id}`, targetId: node.id, targetKind: 'node', ...hit });
        }
    }
    for (const edge of ir.edges) {
        const hit = edgeHotspotKind(edge);
        if (hit) {
            found.push({ id: `hotspot-edge-${edge.id}`, targetId: edge.id, targetKind: 'edge', ...hit });
        }
    }
    // Stable: severity first, then the order the IR already declares, so two
    // runs over the same diagram highlight the same things in the same order.
    return found
        .map((hotspot, order) => ({ hotspot, order }))
        .sort((a, b) => severityRank[a.hotspot.severity] - severityRank[b.hotspot.severity] || a.order - b.order)
        .slice(0, MAX_STORY_HOTSPOTS)
        .map(entry => entry.hotspot);
};
/* ------------------------------------------------------------------ *
 * Derivation.
 * ------------------------------------------------------------------ */

export interface Topology {
    validEdges: DiagramIREdge[];
    outgoing: Map<string, DiagramIREdge[]>;
    inDegree: Map<string, number>;
}

export const buildTopology = (ir: DiagramIR): Topology => {
    const known = new Set(ir.nodes.map(node => node.id));
    const validEdges = ir.edges.filter(edge => known.has(edge.source) && known.has(edge.target));
    const outgoing = new Map<string, DiagramIREdge[]>();
    const inDegree = new Map<string, number>();
    for (const node of ir.nodes) {
        outgoing.set(node.id, []);
        inDegree.set(node.id, 0);
    }
    for (const edge of validEdges) {
        outgoing.get(edge.source)?.push(edge);
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }
    return { validEdges, outgoing, inDegree };
};

/**
 * Where a reader starts. Sources first; when the graph is fully cyclic the
 * human actors are the next best answer, and the busiest node is the last.
 */
export const deriveEntryPoints = (ir: DiagramIR, topology: Topology): string[] => {
    const sources = ir.nodes.filter(node => (topology.inDegree.get(node.id) ?? 0) === 0);
    if (sources.length > 0) return sources.map(node => node.id);

    const actors = ir.nodes.filter(node => {
        const role = node.semanticRole ?? detectSemanticRole(node.label ?? '', node.kind);
        return role === 'person' || role === 'external';
    });
    if (actors.length > 0) return actors.map(node => node.id);

    let best: DiagramIRNode | null = null;
    let bestDegree = -1;
    for (const node of ir.nodes) {
        const degree = topology.outgoing.get(node.id)?.length ?? 0;
        if (degree > bestDegree) {
            best = node;
            bestDegree = degree;
        }
    }
    return best ? [best.id] : [];
};

/** BFS levels from the entry points — one stable level per node, cycles included. */
export const deriveLevels = (ir: DiagramIR, topology: Topology, entryPointIds: string[]): Map<string, number> => {
    const levels = new Map<string, number>();
    const walk = (seeds: string[]) => {
        const queue: string[] = [];
        for (const id of seeds) {
            if (levels.has(id)) continue;
            levels.set(id, 0);
            queue.push(id);
        }
        for (let index = 0; index < queue.length; index++) {
            const current = queue[index];
            const currentLevel = levels.get(current) ?? 0;
            for (const edge of topology.outgoing.get(current) ?? []) {
                if (levels.has(edge.target)) continue;
                levels.set(edge.target, currentLevel + 1);
                queue.push(edge.target);
            }
        }
    };
    walk(entryPointIds);
    // Disconnected components and fully-cyclic islands still have to be read.
    for (const node of ir.nodes) {
        if (!levels.has(node.id)) walk([node.id]);
    }
    return levels;
};

export const stepsFromLevels = (ir: DiagramIR, topology: Topology, levels: Map<string, number>): StoryStep[] => {
    const finite = Array.from(levels.values()).filter(Number.isFinite);
    const maxLevel = Math.min(
        finite.length > 0 ? Math.max(...finite) : 0,
        MAX_STORY_STEPS - 1,
    );
    const steps: StoryStep[] = [];
    for (let level = 0; level <= maxLevel; level++) {
        const isLast = level === maxLevel;
        const nodeIds = ir.nodes
            .filter(node => {
                const nodeLevel = levels.get(node.id) ?? 0;
                return isLast ? nodeLevel >= level : nodeLevel === level;
            })
            .map(node => node.id);
        if (nodeIds.length === 0) continue;
        const inStep = new Set(nodeIds);
        const edgeIds = topology.validEdges
            .filter(edge => inStep.has(edge.source) || inStep.has(edge.target))
            .map(edge => edge.id);
        steps.push({
            id: `story-step-${steps.length + 1}`,
            index: steps.length + 1,
            title: `Paso ${steps.length + 1}`,
            nodeIds,
            edgeIds,
        });
    }
    return steps;
};

/**
 * The heaviest route from an entry point, weighted by declared criticality.
 * Depth-first with a path-local visited set, so a cycle bounds the walk
 * instead of hanging it, and a memo keyed by node so a wide graph does not
 * re-expand the same tail once per predecessor.
 */
export const derivePrimaryPath = (ir: DiagramIR, topology: Topology, entryPointIds: string[]): StoryPath | null => {
    if (topology.validEdges.length === 0) return null;

    interface Route { weight: number; nodeIds: string[]; edgeIds: string[] }

    const memo = new Map<string, Route>();
    const onPath = new Set<string>();

    /**
     * The heaviest tail from `nodeId`, and whether the expansion was complete.
     *
     * A step back onto the current path returns **no route at all** rather than
     * a one-node stub: closing the loop would put the same node in the
     * highlight twice and draw a primary path that returns to where it started,
     * which is not a route a reader can follow. The edge is simply not taken.
     *
     * Only a complete expansion is memoised — a route cut short because it met
     * the current path is true for that call and not in general, and caching it
     * would leak one caller's cycle into another's answer.
     */
    const best = (nodeId: string): { route: Route | null; complete: boolean } => {
        const cached = memo.get(nodeId);
        if (cached) return { route: cached, complete: true };
        if (onPath.has(nodeId)) return { route: null, complete: false };
        onPath.add(nodeId);
        let winner: Route = { weight: 0, nodeIds: [nodeId], edgeIds: [] };
        let complete = true;
        for (const edge of topology.outgoing.get(nodeId) ?? []) {
            const tail = best(edge.target);
            if (!tail.complete) complete = false;
            if (!tail.route) continue;
            const weight = tail.route.weight + (CRITICALITY_WEIGHT[edge.criticality ?? 'low'] ?? 1);
            if (weight > winner.weight) {
                winner = { weight, nodeIds: [nodeId, ...tail.route.nodeIds], edgeIds: [edge.id, ...tail.route.edgeIds] };
            }
        }
        onPath.delete(nodeId);
        if (complete) memo.set(nodeId, winner);
        return { route: winner, complete };
    };

    let chosen: Route | null = null;
    const seeds = entryPointIds.length > 0 ? entryPointIds : ir.nodes.map(node => node.id);
    for (const seed of seeds) {
        const candidate = best(seed).route;
        if (candidate && (!chosen || candidate.weight > chosen.weight)) chosen = candidate;
    }
    if (!chosen || chosen.edgeIds.length === 0) return null;

    const carriesCriticality = chosen.edgeIds.some(id => {
        const edge = topology.validEdges.find(candidate => candidate.id === id);
        return edge?.criticality === 'critical' || edge?.criticality === 'high';
    });
    return {
        nodeIds: chosen.nodeIds,
        edgeIds: chosen.edgeIds,
        rationale: carriesCriticality
            ? 'Ruta más larga ponderada por la criticidad declarada de sus interacciones.'
            : 'Ruta extremo a extremo más larga del grafo; ninguna interacción declara criticidad.',
    };
};

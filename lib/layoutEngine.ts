/**
 * Canonical layout engine for diagram pipelines.
 *
 * Centralises the dagre setup that was previously duplicated across:
 *   - services/diagram/irToReactFlow.ts
 *   - services/diagram/irToExcalidraw.ts
 *   - components/ReactFlowCanvas.tsx
 *
 * Callers describe **what** they want (preset + direction + density) and
 * receive a fully-laid-out graph. The engine reads sizing/spacing from
 * `LAYOUT_PRESETS` so a single design-token change re-skins every renderer.
 *
 * Dagre is intentionally the only layout backend right now; introducing
 * ELK-JS later only requires implementing the same `LayoutResult` contract.
 */

import dagre from 'dagre';
import { LAYOUT_PRESETS, estimateLabelDims } from './diagramTokens';
import type { DiagramIR, DiagramIREdge, DiagramIRNode } from './diagram';

export type LayoutPresetName = keyof typeof LAYOUT_PRESETS;
export type LayoutDirection = 'TB' | 'LR';
export type LayoutDensity = 'compact' | 'normal' | 'spacious';

export interface LayoutOptions {
    /** Sizing/spacing preset (`flow` for ReactFlow, `excalidraw` for boards). */
    preset: LayoutPresetName;
    /** TB = top→bottom, LR = left→right. */
    direction?: LayoutDirection;
    /**
     * Density override; defaults to `normal` which respects the preset
     * exactly. `compact`/`spacious` scale rank/node separation by 0.7×/1.4×.
     */
    density?: LayoutDensity;
    /**
     * Optional label-width estimator override. Defaults to the canonical
     * `estimateLabelDims(label, 11)` so dagre reserves room for edge labels.
     */
    edgeLabelDims?: (label: string | undefined) => { width: number; height: number };
    /**
     * Optional per-node size estimator. When provided, dagre reserves the
     * estimated box for each node instead of the preset's fixed dimensions,
     * which compacts diagrams with terse nodes and prevents clipping on
     * verbose ones. Callers should pair this with a renderer that draws each
     * node at the same estimated size (see `estimateNodeDims`).
     */
    nodeDims?: (node: DiagramIRNode) => { width: number; height: number };
}

export interface PositionedNode {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface LayoutResult {
    direction: LayoutDirection;
    nodeSize: { width: number; height: number };
    positions: Map<string, PositionedNode>;
    /**
     * Per-edge dagre waypoints, keyed by `${source}::${target}::${id}`. Used
     * by Excalidraw to draw polyline routes that avoid the "starburst"
     * effect when many edges share an endpoint.
     */
    edgeWaypoints: Map<string, { x: number; y: number }[]>;
    /** Total bounding box of the laid-out diagram, useful for export sizing. */
    bbox: { width: number; height: number };
}

/** Stable key for {@link LayoutResult.edgeWaypoints}. */
export function edgeWaypointKey(source: string, target: string, id?: string): string {
    return `${source}::${target}::${id ?? ''}`;
}

const DENSITY_SCALE: Record<LayoutDensity, number> = {
    compact:  0.7,
    normal:   1.0,
    spacious: 1.4,
};

/**
 * Direction heuristic — same logic as `irToReactFlow` so legacy call sites
 * keep their layout when migrating to the engine.
 */
export function inferDirection(ir: { nodes: DiagramIRNode[]; edges: DiagramIREdge[]; groups: { id: string }[] }): LayoutDirection {
    const hasPersonas = ir.nodes.some(n => /person|actor|user|usuario|auditor|operator|admin|cliente/i.test(`${n.label} ${n.kind ?? ''}`));
    const sequenceHints = /request|response|envia|send|returns|receives|despu[ée]s|after|invoke|call/i;
    const hasSequence = ir.edges.some(e => e.label && sequenceHints.test(e.label));
    if (hasSequence) return 'LR';
    if (hasPersonas && ir.nodes.length <= 10) return 'LR';
    if (ir.groups.length >= 3) return 'TB';
    return ir.nodes.length >= 8 ? 'TB' : 'LR';
}

type ResolvedLayoutPreset = (typeof LAYOUT_PRESETS)[LayoutPresetName];

/**
 * Adaptive spacing multiplier by node count.
 *
 * Small diagrams need little breathing room; mid-size diagrams get the preset
 * spacing verbatim; large diagrams must *tighten* — otherwise a 15–40 node
 * graph sprawls into an ultra-wide strip that fit-to-view then shrinks until
 * the nodes are unreadable. The previous heuristic did the opposite (1.15× for
 * >14 nodes), which actively worsened large diagrams. Diagrams of ≤14 nodes
 * keep their exact prior spacing, so the layouts that already look good are
 * untouched.
 */
function adaptiveSpacingScale(nodeCount: number): number {
    if (nodeCount <= 8) return 0.9;
    if (nodeCount <= 14) return 1.0;
    // Large diagrams still tighten, but with a higher floor than before:
    // 0.74/0.66 compressed 20-30 node graphs until edges overlapped node
    // cards and each other (the "spaghetti" effect). Routing quality
    // depends on inter-rank corridors, so we trade a little extra canvas
    // for legible edge separation.
    if (nodeCount <= 22) return 0.92;
    if (nodeCount <= 32) return 0.82;
    return 0.74;
}

/** Stable id for the synthetic dagre cluster node that wraps a diagram group. */
function clusterNodeId(group: string): string {
    return `__cluster__${group}`;
}

/**
 * Pick the dagre ranker by graph shape. `tight-tree` produces visibly
 * shorter edges and fewer crossings on tree-like graphs (C4 context with a
 * hub, decomposition diagrams) where `network-simplex` tends to stretch
 * ranks apart. Densely connected graphs keep `network-simplex`, which
 * balances rank assignment better when many cycles/cross-links exist.
 */
export function chooseRanker(nodeCount: number, edgeCount: number): 'tight-tree' | 'network-simplex' {
    if (nodeCount === 0) return 'network-simplex';
    // Tree-like: |E| ≤ |V| (a tree has exactly |V|-1 edges; tolerate one
    // extra cross-link before switching to the general-purpose ranker).
    return edgeCount <= nodeCount ? 'tight-tree' : 'network-simplex';
}

interface DagreRun {
    positions: Map<string, PositionedNode>;
    edgeWaypoints: Map<string, { x: number; y: number }[]>;
    bbox: { width: number; height: number };
}

interface DagreRunConfig {
    direction: LayoutDirection;
    preset: ResolvedLayoutPreset;
    scale: number;
    labelDims: (label: string | undefined) => { width: number; height: number };
    nodeDims?: (node: DiagramIRNode) => { width: number; height: number };
    /**
     * When true, builds a dagre *compound* graph: every diagram group becomes a
     * cluster and its members are re-parented into it. Dagre then keeps each
     * cluster's nodes contiguous and reserves non-overlapping room per cluster
     * — which is what stops the translucent group rectangles drawn downstream
     * from overlapping each other.
     */
    compound: boolean;
}

function runDagre(ir: DiagramIR, cfg: DagreRunConfig): DagreRun {
    const { direction, preset, scale, labelDims, nodeDims, compound } = cfg;
    const g = new dagre.graphlib.Graph({ multigraph: true, compound });
    g.setDefaultEdgeLabel(() => ({}));

    g.setGraph({
        rankdir: direction,
        ranksep: Math.round(preset.spacing.rankSep * scale),
        nodesep: Math.round(preset.spacing.nodeSep * scale),
        edgesep: preset.spacing.edgeSep,
        marginx: preset.spacing.marginX,
        marginy: preset.spacing.marginY,
        ranker: chooseRanker(ir.nodes.length, ir.edges.length),
        // Break cycles greedily so feedback loops (A → B → A) don't force
        // long back-edges that cross the whole canvas.
        acyclicer: 'greedy',
    });

    if (compound) {
        const seenGroups = new Set<string>();
        for (const node of ir.nodes) {
            if (node.group && !seenGroups.has(node.group)) {
                seenGroups.add(node.group);
                g.setNode(clusterNodeId(node.group), {});
            }
        }
    }

    const dimsFor = (node: DiagramIRNode): { width: number; height: number } => {
        if (!nodeDims) return { width: preset.node.width, height: preset.node.height };
        const dims = nodeDims(node);
        return Number.isFinite(dims.width) && Number.isFinite(dims.height) && dims.width > 0 && dims.height > 0
            ? dims
            : { width: preset.node.width, height: preset.node.height };
    };

    for (const node of ir.nodes) {
        g.setNode(node.id, dimsFor(node));
        if (compound && node.group) {
            g.setParent(node.id, clusterNodeId(node.group));
        }
    }
    for (const edge of ir.edges) {
        if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
        const dims = labelDims(edge.label);
        g.setEdge(edge.source, edge.target, { width: dims.width, height: dims.height, labelpos: 'c' }, edge.id);
    }

    dagre.layout(g);

    const positions = new Map<string, PositionedNode>();
    let maxX = 0;
    let maxY = 0;
    for (const node of ir.nodes) {
        const pos = g.node(node.id) as { x: number; y: number } | undefined;
        if (!pos) continue;
        const dims = dimsFor(node);
        const px = pos.x - dims.width / 2;
        const py = pos.y - dims.height / 2;
        positions.set(node.id, {
            id: node.id,
            x: px,
            y: py,
            width: dims.width,
            height: dims.height,
        });
        if (px + dims.width > maxX) maxX = px + dims.width;
        if (py + dims.height > maxY) maxY = py + dims.height;
    }

    const edgeWaypoints = new Map<string, { x: number; y: number }[]>();
    for (const edge of ir.edges) {
        if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
        const dagreEdge = (g.edge(edge.source, edge.target, edge.id) ??
            g.edge({ v: edge.source, w: edge.target, name: edge.id })) as
            { points?: { x: number; y: number }[] } | undefined;
        const points = (dagreEdge?.points ?? []).map((p) => ({ x: p.x, y: p.y }));
        edgeWaypoints.set(edgeWaypointKey(edge.source, edge.target, edge.id), points);
    }

    return {
        positions,
        edgeWaypoints,
        bbox: {
            width:  maxX + preset.spacing.marginX,
            height: maxY + preset.spacing.marginY,
        },
    };
}

/**
 * Two-level grouped layout ("layout jerárquico por grupos").
 *
 * The dagre *compound* mode keeps members contiguous but tends to interleave
 * clusters and produce wide sprawls; the ELK path does not model clusters at
 * all (members scatter and the translucent zones inflate to half the canvas
 * — the exact failure visible in the field screenshots). This pass instead:
 *
 *   1. lays out each group's members independently (tight local dagre);
 *   2. lays out a meta-graph where each group is a single super-node sized
 *      by its internal bounding box (+ zone padding) and each ungrouped node
 *      participates directly;
 *   3. composes the final positions by offsetting the internal layouts into
 *      their super-node slots.
 *
 * Result: every zone is exactly as big as its content, zones can never
 * overlap (the meta-graph reserves their full footprint) and the global
 * bounding box stays compact, which directly raises the fit-to-view zoom.
 */
function runGroupedLayout(ir: DiagramIR, cfg: DagreRunConfig): DagreRun {
    const { direction, preset, scale, labelDims, nodeDims } = cfg;
    const groupOf = new Map<string, string>();
    const membersByGroup = new Map<string, DiagramIRNode[]>();
    const ungrouped: DiagramIRNode[] = [];
    for (const node of ir.nodes) {
        if (node.group) {
            groupOf.set(node.id, node.group);
            const list = membersByGroup.get(node.group) ?? [];
            list.push(node);
            membersByGroup.set(node.group, list);
        } else {
            ungrouped.push(node);
        }
    }

    const zonePadX = preset.group.padding + 8;
    const zonePadTop = preset.group.topPadding + 8;
    const zonePadBottom = preset.group.padding + 8;

    // 1) Internal layout per group (tighter spacing — siblings share context).
    interface InternalLayout {
        positions: Map<string, PositionedNode>;
        waypoints: Map<string, { x: number; y: number }[]>;
        tight: { minX: number; minY: number; width: number; height: number };
    }
    const internals = new Map<string, InternalLayout>();
    for (const [group, members] of membersByGroup) {
        const memberIds = new Set(members.map((m) => m.id));
        const subIR: DiagramIR = {
            nodes: members,
            edges: ir.edges.filter((e) => memberIds.has(e.source) && memberIds.has(e.target)),
            groups: [],
        };
        const run = runDagre(subIR, { direction, preset, scale: scale * 0.8, labelDims, nodeDims, compound: false });
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pos of run.positions.values()) {
            minX = Math.min(minX, pos.x);
            minY = Math.min(minY, pos.y);
            maxX = Math.max(maxX, pos.x + pos.width);
            maxY = Math.max(maxY, pos.y + pos.height);
        }
        if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = preset.node.width; maxY = preset.node.height; }
        internals.set(group, {
            positions: run.positions,
            waypoints: run.edgeWaypoints,
            tight: { minX, minY, width: maxX - minX, height: maxY - minY },
        });
    }

    // 2) Meta-graph: groups as super-nodes + ungrouped nodes.
    const metaId = (nodeId: string): string => {
        const group = groupOf.get(nodeId);
        return group ? `__meta__${group}` : nodeId;
    };
    const meta = new dagre.graphlib.Graph();
    meta.setDefaultEdgeLabel(() => ({}));
    meta.setGraph({
        rankdir: direction,
        ranksep: Math.round(preset.spacing.rankSep * scale),
        nodesep: Math.round(preset.spacing.nodeSep * scale),
        edgesep: preset.spacing.edgeSep,
        marginx: preset.spacing.marginX,
        marginy: preset.spacing.marginY,
        ranker: 'network-simplex',
        acyclicer: 'greedy',
    });
    for (const [group, internal] of internals) {
        meta.setNode(`__meta__${group}`, {
            width: internal.tight.width + zonePadX * 2,
            height: internal.tight.height + zonePadTop + zonePadBottom,
        });
    }
    const fallbackDims = { width: preset.node.width, height: preset.node.height };
    for (const node of ungrouped) {
        const dims = nodeDims ? nodeDims(node) : fallbackDims;
        meta.setNode(node.id, Number.isFinite(dims.width) && dims.width > 0 ? dims : fallbackDims);
    }
    const seenMetaEdges = new Set<string>();
    for (const edge of ir.edges) {
        const src = metaId(edge.source);
        const tgt = metaId(edge.target);
        if (src === tgt) continue;
        if (!meta.hasNode(src) || !meta.hasNode(tgt)) continue;
        const key = `${src}→${tgt}`;
        if (seenMetaEdges.has(key)) continue;
        seenMetaEdges.add(key);
        const dims = labelDims(edge.label);
        meta.setEdge(src, tgt, { width: dims.width, height: dims.height, labelpos: 'c' });
    }
    dagre.layout(meta);

    // 3) Compose final positions.
    const positions = new Map<string, PositionedNode>();
    let maxX = 0;
    let maxY = 0;
    const place = (id: string, x: number, y: number, width: number, height: number) => {
        positions.set(id, { id, x, y, width, height });
        maxX = Math.max(maxX, x + width);
        maxY = Math.max(maxY, y + height);
    };
    for (const [group, internal] of internals) {
        const metaPos = meta.node(`__meta__${group}`) as { x: number; y: number; width: number; height: number } | undefined;
        if (!metaPos) continue;
        const originX = metaPos.x - metaPos.width / 2 + zonePadX - internal.tight.minX;
        const originY = metaPos.y - metaPos.height / 2 + zonePadTop - internal.tight.minY;
        for (const pos of internal.positions.values()) {
            place(pos.id, pos.x + originX, pos.y + originY, pos.width, pos.height);
        }
    }
    for (const node of ungrouped) {
        const metaPos = meta.node(node.id) as { x: number; y: number; width: number; height: number } | undefined;
        if (!metaPos) continue;
        place(node.id, metaPos.x - metaPos.width / 2, metaPos.y - metaPos.height / 2, metaPos.width, metaPos.height);
    }

    // Waypoints: intra-group edges reuse the internal dagre routes (offset
    // into their slot); cross-group edges get a straight 2-point route so
    // downstream consumers (Excalidraw, quality lints) always have geometry.
    const edgeWaypoints = new Map<string, { x: number; y: number }[]>();
    for (const edge of ir.edges) {
        const key = edgeWaypointKey(edge.source, edge.target, edge.id);
        const srcGroup = groupOf.get(edge.source);
        const tgtGroup = groupOf.get(edge.target);
        if (srcGroup && srcGroup === tgtGroup) {
            const internal = internals.get(srcGroup);
            const metaPos = meta.node(`__meta__${srcGroup}`) as { x: number; y: number; width: number; height: number } | undefined;
            const points = internal?.waypoints.get(key);
            if (internal && metaPos && points && points.length > 0) {
                const dx = metaPos.x - metaPos.width / 2 + zonePadX - internal.tight.minX;
                const dy = metaPos.y - metaPos.height / 2 + zonePadTop - internal.tight.minY;
                edgeWaypoints.set(key, points.map((p) => ({ x: p.x + dx, y: p.y + dy })));
                continue;
            }
        }
        const src = positions.get(edge.source);
        const tgt = positions.get(edge.target);
        if (src && tgt) {
            edgeWaypoints.set(key, [
                { x: src.x + src.width / 2, y: src.y + src.height / 2 },
                { x: tgt.x + tgt.width / 2, y: tgt.y + tgt.height / 2 },
            ]);
        }
    }

    return {
        positions,
        edgeWaypoints,
        bbox: {
            width: maxX + preset.spacing.marginX,
            height: maxY + preset.spacing.marginY,
        },
    };
}

export function layoutIR(ir: DiagramIR, opts: LayoutOptions): LayoutResult {
    const preset = LAYOUT_PRESETS[opts.preset];
    const direction = opts.direction ?? inferDirection(ir);
    const density = opts.density ?? 'normal';
    const labelDims = opts.edgeLabelDims ?? ((label) => estimateLabelDims(label, 11));

    const nodeCount = ir.nodes.length || 1;
    const scale = adaptiveSpacingScale(nodeCount) * DENSITY_SCALE[density];
    const baseCfg = { direction, preset, scale, labelDims, nodeDims: opts.nodeDims };

    // Cluster-aware layout: when the diagram has 2+ groups, use the two-level
    // grouped layout so each group's members stay contiguous, every zone is
    // exactly content-sized and zones can never overlap. Falls back to the
    // flat layout if the grouped pass throws or silently drops a node.
    const distinctGroups = new Set(
        ir.nodes.map((n) => n.group).filter((g): g is string => !!g),
    );
    let run: DagreRun | null = null;
    if (distinctGroups.size >= 2) {
        try {
            const groupedRun = runGroupedLayout(ir, { ...baseCfg, compound: false });
            if (groupedRun.positions.size === ir.nodes.length) {
                run = groupedRun;
            } else {
                console.warn('[layoutIR] grouped layout dropped nodes; using flat layout');
            }
        } catch (err) {
            console.warn('[layoutIR] grouped layout failed; using flat layout', err);
        }
    }
    if (!run) run = runDagre(ir, { ...baseCfg, compound: false });

    return {
        direction,
        nodeSize: { width: preset.node.width, height: preset.node.height },
        positions: run.positions,
        edgeWaypoints: run.edgeWaypoints,
        bbox: run.bbox,
    };
}

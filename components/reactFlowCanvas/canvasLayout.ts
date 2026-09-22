/**
 * Canvas layout — turning a graph into positioned nodes.
 *
 * Extracted from `ReactFlowCanvas.tsx`, which reached 2.715 lines by the
 * ordinary route: nobody added a thousand lines, everyone added forty. This
 * was the largest block that is not React at all — pure input to output over
 * ReactFlow's `Node`/`Edge` shapes — so moving it costs the component nothing
 * and makes it testable without mounting a canvas.
 *
 * The paint helpers are re-exported from `ReactFlowCanvas`, so the extraction
 * changed where the code lives and not the module's public shape. That is what
 * let 680 lines move without touching a single call site.
 */

import { MarkerType, Position, type Edge, type Node } from 'reactflow';
import { estimateLabelDims, estimateNodeDims, LAYOUT_PRESETS, MARKER_TOKENS } from '../../lib/diagramTokens';
import type { DiagramDensity, NodeShape } from '../../lib/diagram';
import { inferDirection, layoutIR } from '../../lib/layoutEngine';
import { separateGroupClusters } from '../../services/diagram/groupZoneSeparation';
import { computeEdgeLabelSlots } from '../../services/diagram/edgeLabelSlots';
import { selectLayoutDirective } from '../../services/diagram/layoutDirective';

// Node dimensions — sourced from the canonical layout preset so a single
// token change re-skins both the layout calc and the export bounds.
export const NODE_WIDTH = LAYOUT_PRESETS.flow.node.width;
export const NODE_HEIGHT = LAYOUT_PRESETS.flow.node.height;

/**
 * ReactFlow's `onlyRenderVisibleElements` is a major perf win for graphs
 * with many nodes (it skips DOM creation for nodes outside the viewport).
 * Below this threshold the simpler full-render path is faster on first
 * mount; above it, virtualisation pays off.
 */
export const VIRTUALIZATION_THRESHOLD = 30;
/**
 * Above this node count the minimap turns on automatically: large diagrams
 * routinely exceed the readable zoom window, so the architect needs the
 * overview + click-to-navigate affordance without hunting for a toggle.
 */
export const AUTO_MINIMAP_THRESHOLD = 20;
const GRID_CELL_WIDTH = 320;
const GRID_CELL_HEIGHT = 220;

export const isFiniteCanvasPosition = (position: { x?: number; y?: number } | undefined): position is { x: number; y: number } => (
    Number.isFinite(position?.x) && Number.isFinite(position?.y)
);

const getGridPosition = (index: number, total: number): { x: number; y: number } => {
    const cols = Math.max(1, Math.ceil(Math.sqrt(total || 1)));
    return {
        x: (index % cols) * GRID_CELL_WIDTH,
        y: Math.floor(index / cols) * GRID_CELL_HEIGHT,
    };
};

const hasUsableLabel = (value: unknown): value is string => (typeof value === 'string' && value.trim().length > 0);

const normalizeNodeForCanvas = (node: Node, density: DiagramDensity, position: { x: number; y: number }): Node => {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const id = String(node.id);
    const label = hasUsableLabel(data.label) ? data.label : id;
    return {
        ...node,
        id,
        type: 'custom',
        data: {
            ...data,
            label,
            density,
        },
        position,
    };
};

export const prepareNodesForInitialPaint = (inputNodes: Node[], density: DiagramDensity): Node[] => (inputNodes || []).map((node, index) => (
    normalizeNodeForCanvas(
        node,
        density,
        // ReactFlow requires every node to have a finite position before the
        // first paint. If the async layout pass is cancelled by a parent remount
        // or an animated container, this grid gives the user a visible, editable
        // diagram instead of a permanent blank canvas.
        isFiniteCanvasPosition(node.position)
            ? node.position
            : getGridPosition(index, inputNodes.length),
    )
));

export const materializeNodesOnVisibleGrid = (inputNodes: Node[], density: DiagramDensity): Node[] => (inputNodes || [])
    .filter(node => node.type !== 'groupZone')
    .map((node, index, nodes) => normalizeNodeForCanvas(node, density, getGridPosition(index, nodes.length)));

export const prepareEdgesForInitialPaint = (inputEdges: Edge[], nodeIds: Set<string>): Edge[] => processEdges(
    (inputEdges || []).filter(edge =>
        nodeIds.has(String(edge.source)) && nodeIds.has(String(edge.target))
    ).map(edge => ({
        ...edge,
        id: String(edge.id || `edge-${edge.source}-${edge.target}`),
        source: String(edge.source),
        target: String(edge.target),
    }))
);

// --- Layout presets ---
export type LayoutPreset = 'compact' | 'normal' | 'spacious';
const mapLayoutPresetToDensity = (preset: LayoutPreset): 'compact' | 'normal' | 'spacious' => {
    if (preset === 'compact') return 'compact';
    if (preset === 'spacious') return 'spacious';
    return 'normal';
};

export const calculateLayout = (nodes: Node[], edges: Edge[], direction: 'TB' | 'LR' = 'TB', preset: LayoutPreset = 'normal') => {
    try {
        const density = mapLayoutPresetToDensity(preset);
        const ir = {
            nodes: nodes.map((node) => ({
                id: node.id,
                label: String((node.data as { label?: string })?.label ?? node.id),
                kind: String((node.data as { kind?: string; type?: string })?.kind ?? (node.data as { type?: string })?.type ?? 'Component'),
                description: String((node.data as { description?: string })?.description ?? '') || undefined,
                group: (node.data as { group?: string })?.group,
                shape: (node.data as { shape?: NodeShape })?.shape,
            })),
            edges: edges.map((edge) => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                label: String((edge.label as string | undefined) ?? '').trim() || 'Relaciona',
                relation: (edge.data as { edgeType?: 'default' })?.edgeType ?? 'default',
            })),
            groups: [],
        };
        const layout = layoutIR(ir, {
            preset: 'flow',
            direction,
            density,
            edgeLabelDims: (label) => estimateLabelDims(label, 11),
            nodeDims: (node) => estimateNodeDims(node, density),
        });
        const isHorizontal = direction === 'LR';
        const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length || 1)));
        let missing = 0;
        const layoutedNodes = nodes.map((node, idx) => {
            const pos = layout.positions.get(node.id);
            // Fallback: if dagre didn't return a position for this node (rare,
            // but possible when ids contain unusual chars or the engine bails
            // mid-graph) place it on a stable grid instead of stacking every
            // missing node at (0,0). Stacking caused the "empty canvas" bug
            // for C4 Container/Component artifacts where every node ended up
            // at the same coordinates and rendered invisibly behind one
            // another.
            const fallback = {
                x: (idx % cols) * GRID_CELL_WIDTH,
                y: Math.floor(idx / cols) * GRID_CELL_HEIGHT,
            };
            if (!pos || !isFiniteCanvasPosition(pos)) missing += 1;
            return {
                ...node,
                targetPosition: isHorizontal ? Position.Left : Position.Top,
                sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
                data: {
                    ...(node.data ?? {}),
                    // Keep the painted card size in sync with the box dagre
                    // reserved for this node (content-adaptive sizing).
                    width: pos?.width ?? (node.data as { width?: number })?.width,
                    height: pos?.height ?? (node.data as { height?: number })?.height,
                },
                position: pos && isFiniteCanvasPosition(pos)
                    ? { x: pos.x, y: pos.y }
                    : fallback,
            };
        });
        if (missing > 0) {
            console.warn(`[calculateLayout] Dagre missed positions for ${missing}/${nodes.length} nodes; falling back to grid for those.`);
        }
        return { nodes: applyGroupSeparation(layoutedNodes), edges };
    } catch (error) {
        console.error("Layout calculation critical failure:", error);
        // Same defence as above: when the engine throws entirely, lay nodes
        // on a grid so the canvas always renders something instead of going
        // dark.
        const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length || 1)));
        const fallbackNodes = nodes.map((node, idx) => ({
            ...node,
            position: {
                x: (idx % cols) * GRID_CELL_WIDTH,
                y: Math.floor(idx / cols) * GRID_CELL_HEIGHT,
            },
        }));
        return { nodes: fallbackNodes, edges };
    }
};

/**
 * Canvas adapter over `separateGroupClusters`: translates whole group
 * clusters apart when their translucent zones would overlap. No-op (same
 * references) when the layout is already clean or has < 2 groups.
 */
export const applyGroupSeparation = (nodes: Node[]): Node[] => {
    const rects = nodes.map((node) => {
        const data = (node.data ?? {}) as { group?: string; width?: number; height?: number };
        return {
            id: String(node.id),
            group: node.type === 'groupZone' ? undefined : data.group,
            x: node.position?.x ?? 0,
            y: node.position?.y ?? 0,
            width: data.width ?? node.width ?? NODE_WIDTH,
            height: data.height ?? node.height ?? NODE_HEIGHT,
        };
    });
    const separated = separateGroupClusters(rects);
    if (separated === rects) return nodes;
    const byId = new Map(separated.map((r) => [r.id, r] as const));
    return nodes.map((node) => {
        const rect = byId.get(String(node.id));
        if (!rect) return node;
        const x = node.position?.x ?? 0;
        const y = node.position?.y ?? 0;
        if (rect.x === x && rect.y === y) return node;
        return { ...node, position: { x: rect.x, y: rect.y } };
    });
};

export const detectOptimalDirection = (
    nodes: Node[],
    edges: Edge[],
    options: { title?: string; archetypeHint?: string } = {},
): 'TB' | 'LR' => {
    const lightweightIR = {
        nodes: nodes.map((n) => ({
            id: n.id,
            label: String((n.data as { label?: string })?.label ?? n.id),
            kind: String((n.data as { kind?: string; type?: string })?.kind ?? (n.data as { type?: string })?.type ?? 'Component'),
            semanticType: (n.data as { semanticType?: string })?.semanticType,
            semanticRole: (n.data as { semanticRole?: string })?.semanticRole,
        })),
        edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            label: String((e.label as string | undefined) ?? '').trim() || 'Relaciona',
        })),
        groups: [] as Array<{ id: string; label: string; nodeIds: string[] }>,
    };

    // Archetype-aware directive wins when the title/semantic types declare
    // a clear intent (value stream → LR, BPMN with lanes → LR, integration
    // → TB). For unknown archetypes the directive returns `null` and we
    // fall back to the legacy `inferDirection` heuristic so existing
    // generic diagrams keep their layout.
    if (options.title || options.archetypeHint) {
        try {
            const directive = selectLayoutDirective({
                nodes: lightweightIR.nodes as never,
                edges: lightweightIR.edges as never,
                groups: lightweightIR.groups,
                metadata: { title: options.title },
            });
            if (directive.direction !== null) return directive.direction;
        } catch {
            // Defensive: if the directive throws we keep the legacy heuristic.
        }
    }

    return inferDirection(lightweightIR as never);
};

// Derive edge styles from metadata
export const processEdges = (edges: Edge[]): Edge[] => {
    // Parallel-edge label ladder for the legacy path (edges that didn't go
    // through `irToReactFlow`): assign each edge of a same-pair bundle a
    // slot so CustomEdge fans the labels out instead of stacking them.
    const labelSlots = computeEdgeLabelSlots(edges);
    return edges.map(e => ({
        ...e,
        type: 'custom',
        // Keep the relation-specific marker when the canonical pipeline
        // already chose one (data-flow wide arrows, dependency open arrows…).
        markerEnd: e.markerEnd ?? {
            type: MarkerType.ArrowClosed,
            color: '#64748b',
            width: MARKER_TOKENS.default.width,
            height: MARKER_TOKENS.default.height,
        },
        label: (typeof e.label === 'string' && e.label.trim().length > 0) ? e.label : 'Relaciona',
        data: {
            ...(e.data ?? {}),
            labelSlot: (e.data as { labelSlot?: unknown } | undefined)?.labelSlot ?? labelSlots.get(String(e.id)),
        },
    }));
};

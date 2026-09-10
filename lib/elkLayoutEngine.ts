/**
 * ELK.js layout backend.
 *
 * Provides the same `LayoutResult` contract as `layoutEngine.ts` (dagre) but
 * with access to the Eclipse Layout Kernel's richer algorithm portfolio:
 *
 *  - `layered`   — modern hierarchical (replacement for dagre, fewer crossings)
 *  - `mrtree`    — minimum-route trees (great for service hierarchies)
 *  - `force`     — physics-based, ideal for ERD / domain models
 *  - `radial`    — central node + concentric rings (C4 Context)
 *  - `stress`    — stress-majorisation, balanced graphs
 *
 * ELK runs synchronously when its `Promise<ElkNode>` is awaited, and the WASM
 * worker is bundled into the page automatically by the `elkjs/lib/elk.bundled`
 * entry point — no extra Vite config required.  The cost is ~150 KB gzipped,
 * within the user's pragmatic dependency budget.
 *
 * The result mirrors `LayoutResult` from `lib/layoutEngine.ts` so callers
 * can swap dagre for ELK transparently.
 */

import ELK from 'elkjs/lib/elk.bundled.js';
import { LAYOUT_PRESETS, estimateLabelDims } from './diagramTokens';
import type { DiagramIR } from './diagram';
import type {
    LayoutDirection,
    LayoutPresetName,
    LayoutResult,
    PositionedNode,
} from './layoutEngine';
import { edgeWaypointKey, inferDirection } from './layoutEngine';

export type ElkAlgorithm = 'layered' | 'mrtree' | 'force' | 'radial' | 'stress' | 'box';

export interface ElkLayoutOptions {
    /** Sizing/spacing preset (`flow` for ReactFlow, `excalidraw` for boards). */
    preset: LayoutPresetName;
    /** TB | LR — only honoured by `layered`. */
    direction?: LayoutDirection;
    /** ELK algorithm to dispatch.  Default: `layered`. */
    algorithm?: ElkAlgorithm;
    /** Optional density override (multiplies spacing). */
    densityScale?: number;
    /** Optional label dim estimator (defaults to `estimateLabelDims`). */
    edgeLabelDims?: (label: string | undefined) => { width: number; height: number };
    /**
     * Optional per-node dim estimator. Without it ELK plans with the fixed
     * preset box (260×160) while the renderer paints content-adaptive cards,
     * so reserved space and painted space drift apart on text-heavy nodes.
     */
    nodeDims?: (node: DiagramIR['nodes'][number]) => { width: number; height: number };
    /**
     * When true, lays out the diagram so edges are routed orthogonally —
     * appropriate for `layered`/`box`. ELK ignores this flag for `force`.
     */
    orthogonal?: boolean;
}

const elk = new ELK();

const DEFAULT_OPTIONS: Record<ElkAlgorithm, Record<string, string>> = {
    layered: {
        'elk.algorithm': 'layered',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.crossingMinimization.semiInteractive': 'true',
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.nodePlacement.favorStraightEdges': 'true',
        // Extra optimisation passes: measurably fewer crossings on 15-35
        // node graphs for a negligible layout-time cost.
        'elk.layered.thoroughness': '7',
        'elk.spacing.componentComponent': '60',
        'elk.spacing.edgeEdge': '24',
        'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
        'elk.layered.spacing.edgeNodeBetweenLayers': '32',
    },
    mrtree: {
        'elk.algorithm': 'mrtree',
        'elk.mrtree.searchOrder': 'DFS',
    },
    force: {
        'elk.algorithm': 'force',
        'elk.force.iterations': '300',
    },
    radial: {
        'elk.algorithm': 'radial',
    },
    stress: {
        'elk.algorithm': 'stress',
    },
    box: {
        'elk.algorithm': 'box',
    },
};

function elkDirection(direction: LayoutDirection): string {
    return direction === 'TB' ? 'DOWN' : 'RIGHT';
}

/**
 * Lay out an IR with ELK and return a `LayoutResult` shaped exactly like the
 * dagre-backed engine, so downstream renderers stay agnostic.
 */
export async function layoutIRWithELK(ir: DiagramIR, opts: ElkLayoutOptions): Promise<LayoutResult> {
    const preset = LAYOUT_PRESETS[opts.preset];
    const direction = opts.direction ?? inferDirection(ir);
    const algorithm: ElkAlgorithm = opts.algorithm ?? 'layered';
    const densityScale = opts.densityScale ?? 1;
    const labelDims = opts.edgeLabelDims ?? ((label) => estimateLabelDims(label, 11));

    const layoutOptions: Record<string, string> = {
        ...DEFAULT_OPTIONS[algorithm],
        'elk.direction': elkDirection(direction),
        'elk.spacing.nodeNode': String(Math.round(preset.spacing.nodeSep * densityScale)),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(preset.spacing.rankSep * densityScale)),
        'elk.spacing.edgeNode': String(preset.spacing.edgeSep),
        'elk.padding': `[top=${preset.spacing.marginY},left=${preset.spacing.marginX},bottom=${preset.spacing.marginY},right=${preset.spacing.marginX}]`,
    };
    if (opts.orthogonal && algorithm === 'layered') {
        layoutOptions['elk.edgeRouting'] = 'ORTHOGONAL';
    }

    const elkGraph = {
        id: 'root',
        layoutOptions,
        children: ir.nodes.map((node) => {
            const dims = opts.nodeDims?.(node);
            return {
                id: node.id,
                width: dims?.width ?? preset.node.width,
                height: dims?.height ?? preset.node.height,
            };
        }),
        edges: ir.edges
            .filter((e) =>
                ir.nodes.some((n) => n.id === e.source) &&
                ir.nodes.some((n) => n.id === e.target),
            )
            .map((edge) => {
                const dims = labelDims(edge.label);
                return {
                    id: edge.id,
                    sources: [edge.source],
                    targets: [edge.target],
                    labels: edge.label
                        ? [{ text: edge.label, width: dims.width, height: dims.height }]
                        : [],
                };
            }),
    };

    type ElkNode = {
        children?: Array<{ id: string; x?: number; y?: number; width?: number; height?: number }>;
        edges?: Array<{
            id: string; sources: string[]; targets: string[];
            sections?: Array<{
                startPoint: { x: number; y: number };
                endPoint: { x: number; y: number };
                bendPoints?: Array<{ x: number; y: number }>;
            }>;
        }>;
        width?: number;
        height?: number;
    };

    const laidOut = (await elk.layout(elkGraph as never)) as ElkNode;

    const positions = new Map<string, PositionedNode>();
    let maxX = 0;
    let maxY = 0;
    for (const child of laidOut.children ?? []) {
        const x = child.x ?? 0;
        const y = child.y ?? 0;
        const w = child.width ?? preset.node.width;
        const h = child.height ?? preset.node.height;
        positions.set(child.id, { id: child.id, x, y, width: w, height: h });
        if (x + w > maxX) maxX = x + w;
        if (y + h > maxY) maxY = y + h;
    }

    const edgeWaypoints = new Map<string, { x: number; y: number }[]>();
    for (const elkEdge of laidOut.edges ?? []) {
        const irEdge = ir.edges.find((e) => e.id === elkEdge.id);
        if (!irEdge) continue;
        const section = elkEdge.sections?.[0];
        const points: { x: number; y: number }[] = [];
        if (section) {
            points.push({ x: section.startPoint.x, y: section.startPoint.y });
            for (const bp of section.bendPoints ?? []) points.push({ x: bp.x, y: bp.y });
            points.push({ x: section.endPoint.x, y: section.endPoint.y });
        }
        edgeWaypoints.set(edgeWaypointKey(irEdge.source, irEdge.target, irEdge.id), points);
    }

    return {
        direction,
        nodeSize: { width: preset.node.width, height: preset.node.height },
        positions,
        edgeWaypoints,
        bbox: {
            width:  Math.max(maxX, laidOut.width ?? 0) + preset.spacing.marginX,
            height: Math.max(maxY, laidOut.height ?? 0) + preset.spacing.marginY,
        },
    };
}

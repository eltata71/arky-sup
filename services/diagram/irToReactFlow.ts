/**
 * Deterministic DiagramIR → ReactFlow serializer.
 *
 * Layout is computed by the canonical layout engine (`lib/layoutEngine`);
 * colours & sizes come from `lib/diagramTokens`. This module never touches
 * the LLM — any call site that uses it is free of AI hop #2 (Mermaid →
 * ReactFlow JSON) semantic drift.
 */

import type { Edge, MarkerType, Node } from 'reactflow';
import type { ArtifactType } from '../../types';
import type { DiagramIR, DiagramIREdge, DiagramIRNode } from '../../lib/diagram';
import { layoutIR, inferDirection, type LayoutResult } from '../../lib/layoutEngine';
import { layoutIRWithELK } from '../../lib/elkLayoutEngine';
import { selectLayoutPlan, selectFallbackPlan, DENSITY_SCALE, type LayoutPlan } from '../../lib/layoutSelector';
import { LAYOUT_PRESETS, MARKER_TOKENS, estimateNodeDims, type EdgeRelationKey } from '../../lib/diagramTokens';
import { resolveEdgeCategoryLabel, resolveNodeCategoryLabel } from '../../lib/diagramCategoryLabels';
import { resolveEdgeRoutingDecision } from './edgeRoutingPolicy';
import { resolveNodeHierarchy, resolveEdgeHierarchy } from './visualHierarchyPolicy';
import { resolveEdgeLabelDecision, resolveNodeLabelDecision } from './labelPolicy';
import { computeEdgeLabelSlots } from './edgeLabelSlots';
import { computeGroupSeparationOffsets } from './groupZoneSeparation';
import { assignEdgeAnchors } from './edgeHandleAssignment';

export interface IRToReactFlowResult {
    nodes: Node[];
    edges: Edge[];
}

export interface IRToReactFlowOptions {
    /**
     * When `true`, an IR with zero nodes materializes a single visible
     * placeholder node ("Diagrama no disponible") so the canvas never
     * appears blank. Defaults to `false` — callers should prefer to catch
     * {@link EmptyIRError} and render a banner with corrective actions.
     */
    allowEmptyPlaceholder?: boolean;
}

/**
 * Thrown by {@link irToReactFlow} when the input IR has no nodes and the
 * caller has not opted into a placeholder. Carries no extra payload — the
 * caller already has the IR and can decide whether to render an empty-state
 * banner or trigger a corrective regeneration.
 */
export class EmptyIRError extends Error {
    constructor() {
        super('IR contains zero nodes; refusing to render an empty canvas silently.');
        this.name = 'EmptyIRError';
    }
}

/**
 * True when the IR declares a manual layout AND enough nodes carry a finite
 * persisted position to honour it (≥ 60% — tolerates a few nodes added after
 * the manual pass, which fall back to a grid near the content).
 */
export function hasManualLayout(ir: DiagramIR): boolean {
    if (ir.metadata?.layoutMode !== 'manual') return false;
    if (ir.nodes.length === 0) return false;
    const positioned = ir.nodes.filter((n) =>
        Number.isFinite(n.position?.x) && Number.isFinite(n.position?.y),
    ).length;
    return positioned >= Math.ceil(ir.nodes.length * 0.6);
}

/**
 * Build a layout result straight from the persisted per-node positions so
 * the architect's manual canvas adjustments survive re-renders. Nodes
 * without a stored position are placed on a grid below the existing content
 * so they are visible and easy to drag into place.
 */
function manualLayout(ir: DiagramIR): LayoutResult {
    const preset = LAYOUT_PRESETS.flow;
    const density = densityForIR(ir);
    const positions = new Map<string, { id: string; x: number; y: number; width: number; height: number }>();
    let maxX = 0;
    let maxY = 0;
    const unplaced: DiagramIRNode[] = [];
    for (const node of ir.nodes) {
        const dims = estimateNodeDims(node, density);
        const pos = node.position;
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
            positions.set(node.id, { id: node.id, x: pos.x, y: pos.y, ...dims });
            maxX = Math.max(maxX, pos.x + dims.width);
            maxY = Math.max(maxY, pos.y + dims.height);
        } else {
            unplaced.push(node);
        }
    }
    unplaced.forEach((node, idx) => {
        const dims = estimateNodeDims(node, density);
        positions.set(node.id, {
            id: node.id,
            x: idx * (dims.width + 60),
            y: maxY + 80,
            ...dims,
        });
    });
    return {
        direction: ir.metadata?.layoutPlan?.direction === 'LR' ? 'LR' : 'TB',
        nodeSize: { width: preset.node.width, height: preset.node.height },
        positions,
        edgeWaypoints: new Map(),
        bbox: { width: maxX + preset.spacing.marginX, height: maxY + preset.spacing.marginY },
    };
}

function densityForIR(ir: DiagramIR): 'compact' | 'normal' | 'spacious' {
    const planDensity = ir.metadata?.layoutPlan?.density;
    return planDensity === 'compact' || planDensity === 'spacious' ? planDensity : 'normal';
}

export function irToReactFlow(ir: DiagramIR, opts: IRToReactFlowOptions = {}): IRToReactFlowResult {
    if (ir.nodes.length === 0) {
        if (opts.allowEmptyPlaceholder) {
            console.warn('[irToReactFlow] IR has zero nodes; rendering visible placeholder.');
            return materializeEmptyPlaceholder();
        }
        throw new EmptyIRError();
    }
    if (hasManualLayout(ir)) {
        return materialize(ir, manualLayout(ir), { separateGroups: false });
    }
    try {
        const direction = inferDirection(ir);
        const density = densityForIR(ir);
        const layout = layoutIR(ir, {
            preset: 'flow',
            direction,
            nodeDims: (node) => estimateNodeDims(node, density),
        });
        const result = materialize(ir, layout);
        // Defence in depth: if layout silently produces zero positioned nodes
        // for an IR that had nodes, fall back to a deterministic grid so the
        // canvas never appears empty.  This is the renderer's last-resort
        // contract: "IR with N nodes ⇒ canvas with N nodes".
        if (result.nodes.length === 0 && ir.nodes.length > 0) {
            console.warn('[irToReactFlow] dagre returned zero positioned nodes; using grid fallback');
            return materializeGridFallback(ir);
        }
        return result;
    } catch (err) {
        console.error('[irToReactFlow] layout threw, using grid fallback', err);
        return materializeGridFallback(ir);
    }
}

function materializeEmptyPlaceholder(): IRToReactFlowResult {
    return {
        nodes: [
            {
                id: 'empty-placeholder',
                type: 'custom',
                position: { x: 0, y: 0 },
                data: {
                    label: 'Diagrama no disponible',
                    type: 'Placeholder',
                    description: 'El generador no produjo nodos. Pulsa "Regenerar" para reintentar con menos contexto.',
                    kind: 'Placeholder',
                },
            },
        ],
        edges: [],
    };
}

/**
 * Async layout-aware variant that consults the layout selector.  When the
 * selector picks ELK, we await the ELK pass; otherwise we fall back to the
 * synchronous dagre engine.  All call sites that can `await` should prefer
 * this entry point because it produces world-class layouts (radial for C4
 * Context, force for ERD, mrtree for service meshes, layered everywhere
 * else).
 */
export async function irToReactFlowSmart(
    ir: DiagramIR,
    artifactType?: ArtifactType,
): Promise<IRToReactFlowResult & { plan: ReturnType<typeof selectLayoutPlan> }> {
    if (hasManualLayout(ir)) {
        const persisted = ir.metadata?.layoutPlan;
        const plan: LayoutPlan = {
            backend: persisted?.backend === 'elk' ? 'elk' : 'dagre',
            algorithm: 'layered',
            direction: persisted?.direction === 'LR' ? 'LR' : 'TB',
            density: densityForIR(ir),
            orthogonal: persisted?.orthogonal ?? false,
            rationale: 'Disposición manual del arquitecto: se respetan las posiciones guardadas del lienzo.',
            userOverride: true,
        };
        return { ...materialize(ir, manualLayout(ir), { separateGroups: false }), plan };
    }
    const plan = selectLayoutPlan({ ir, artifactType });
    const densityScale = DENSITY_SCALE[plan.density];
    // Grouped diagrams: ELK has no cluster support here, so its layered pass
    // scatters group members across the canvas and the translucent zones
    // inflate until they cover half the viewport. Route them through the
    // two-level grouped dagre layout instead (members contiguous, zones
    // content-sized, no overlaps) while keeping the selector's direction
    // and density decisions.
    const distinctGroups = new Set(ir.nodes.map((n) => n.group).filter(Boolean));
    if (distinctGroups.size >= 2) {
        const layout = layoutIR(ir, {
            preset: 'flow',
            direction: plan.direction,
            density: plan.density,
            nodeDims: (node) => estimateNodeDims(node, plan.density),
        });
        const groupedPlan: LayoutPlan = {
            ...plan,
            backend: 'dagre',
            algorithm: 'layered',
            orthogonal: false,
            rationale: `Diagrama con ${distinctGroups.size} agrupaciones: layout jerárquico por grupos (miembros contiguos, zonas sin solapamiento).`,
        };
        return { ...materialize(ir, layout), plan: groupedPlan };
    }
    if (plan.backend === 'elk') {
        try {
            const layout = await layoutIRWithELK(ir, {
                preset: 'flow',
                direction: plan.direction,
                algorithm: plan.algorithm,
                orthogonal: plan.orthogonal,
                densityScale,
                nodeDims: (node) => estimateNodeDims(node, plan.density),
            });
            return { ...materialize(ir, layout), plan };
        } catch (err) {
            // ELK failures (WASM not initialised, browser sandbox issues) fall
            // back to the deterministic dagre path so the canvas always renders.
            console.warn('[irToReactFlowSmart] ELK failed, falling back to dagre', err);
            const fallback = selectFallbackPlan({ ir, artifactType });
            const layout = layoutIR(ir, {
                preset: 'flow',
                direction: fallback.direction,
                density: fallback.density,
                nodeDims: (node) => estimateNodeDims(node, fallback.density),
            });
            return { ...materialize(ir, layout), plan: fallback };
        }
    }
    const layout = layoutIR(ir, {
        preset: 'flow',
        direction: plan.direction,
        density: plan.density,
        nodeDims: (node) => estimateNodeDims(node, plan.density),
    });
    return { ...materialize(ir, layout), plan };
}

function materialize(
    ir: DiagramIR,
    layout: LayoutResult,
    opts: { separateGroups?: boolean } = {},
): IRToReactFlowResult {
    let nodes: Node[] = ir.nodes.map((node) => buildNode(ir, node, layout));
    // Group-zone overlap guard: automatic layouts (dagre flat pass, ELK)
    // can land two clusters on intersecting bounding boxes; translate the
    // whole clusters apart so the translucent zones never overlap. Manual
    // layouts skip this — the architect's positions are authoritative.
    if (opts.separateGroups !== false && ir.groups.length >= 2) {
        const offsets = computeGroupSeparationOffsets(nodes.map((n) => {
            const data = (n.data ?? {}) as { group?: string; width?: number; height?: number };
            return {
                id: String(n.id),
                group: data.group,
                x: n.position?.x ?? 0,
                y: n.position?.y ?? 0,
                width: data.width ?? layout.nodeSize.width,
                height: data.height ?? layout.nodeSize.height,
            };
        }));
        if (offsets.size > 0) {
            nodes = nodes.map((n) => {
                const data = (n.data ?? {}) as { group?: string };
                const off = data.group ? offsets.get(data.group) : undefined;
                if (!off) return n;
                return { ...n, position: { x: (n.position?.x ?? 0) + off.dx, y: (n.position?.y ?? 0) + off.dy } };
            });
        }
    }
    const groupByNodeId = new Map<string, string>();
    for (const n of ir.nodes) {
        if (n.group) groupByNodeId.set(n.id, n.group);
    }
    const pairFreq = new Map<string, number>();
    for (const e of ir.edges) {
        const srcGroup = groupByNodeId.get(e.source) ?? e.source;
        const tgtGroup = groupByNodeId.get(e.target) ?? e.target;
        const key = `${srcGroup}::${tgtGroup}`;
        pairFreq.set(key, (pairFreq.get(key) ?? 0) + 1);
    }
    // BPMN edge enrichment: when the diagram is a BPMN process we compute
    // a `crossLane` hint per edge so the renderer can default cross-lane
    // edges to message-flow styling (BPMN 2.0 reserves sequence-flow for
    // within-lane traffic). The hint is conservative: it is set ONLY when
    // both endpoints belong to a different swimlane group.
    const isBpmn = ir.metadata?.diagramType === 'bpmn-process';
    const laneByNode = new Map<string, string>();
    if (isBpmn) {
        for (const group of ir.groups) {
            if (group.kind !== 'swimlane') continue;
            for (const nodeId of group.nodeIds) laneByNode.set(nodeId, group.id);
        }
    }
    const edges: Edge[] = ir.edges
        .filter((e) => layout.positions.has(e.source) && layout.positions.has(e.target))
        .map((e) => {
            const built = buildEdge(ir, e);
            const srcGroup = groupByNodeId.get(e.source) ?? e.source;
            const tgtGroup = groupByNodeId.get(e.target) ?? e.target;
            const pairKey = `${srcGroup}::${tgtGroup}`;
            const bundled = (pairFreq.get(pairKey) ?? 0) >= 3;
            const crossBoundary = Boolean(groupByNodeId.get(e.source) && groupByNodeId.get(e.target) && groupByNodeId.get(e.source) !== groupByNodeId.get(e.target));
            const isSecondary = !e.criticality && (e.relation === 'dependency' || e.relation === 'default');
            if (!isBpmn) return built;
            const srcLane = laneByNode.get(e.source);
            const tgtLane = laneByNode.get(e.target);
            const crossLane = Boolean(srcLane && tgtLane && srcLane !== tgtLane);
            return {
                ...built,
                data: {
                    ...(built.data ?? {}),
                    crossLane,
                    isBpmn: true,
                    bundled,
                    crossBoundary,
                    isSecondary,
                },
            };
        });
    // Non-BPMN edges still benefit from bundling and boundary hints.
    // Label slots fan out the labels of parallel edges (same node pair) so
    // they stop stacking at the shared midpoint.
    const labelSlots = computeEdgeLabelSlots(edges);
    const enrichedEdges = edges.map((edge) => {
        const srcGroup = groupByNodeId.get(edge.source) ?? edge.source;
        const tgtGroup = groupByNodeId.get(edge.target) ?? edge.target;
        const pairKey = `${srcGroup}::${tgtGroup}`;
        const bundled = (pairFreq.get(pairKey) ?? 0) >= 3;
        const crossBoundary = Boolean(groupByNodeId.get(edge.source) && groupByNodeId.get(edge.target) && groupByNodeId.get(edge.source) !== groupByNodeId.get(edge.target));
        const relation = ((edge.data as { edgeType?: string } | undefined)?.edgeType ?? 'default');
        const isSecondary = relation === 'dependency' || relation === 'default';
        return {
            ...edge,
            data: {
                ...(edge.data ?? {}),
                bundled,
                crossBoundary,
                isSecondary,
                labelSlot: labelSlots.get(String(edge.id)),
            },
        };
    });
    // Geometric anchors: each edge leaves/enters through the node side that
    // faces its counterpart, killing the hub "starburst" of long curves.
    return { nodes, edges: assignEdgeAnchors(nodes, enrichedEdges) };
}

/**
 * Last-resort renderer used when the layout engine throws or yields zero
 * positioned nodes.  Lays the IR out on a square grid so the user always
 * sees something — they can re-run the layout from the toolbar afterwards.
 */
function materializeGridFallback(ir: DiagramIR): IRToReactFlowResult {
    const cols = Math.max(1, Math.ceil(Math.sqrt(ir.nodes.length)));
    const cellW = 320;
    const cellH = 220;
    const nodes: Node[] = ir.nodes.map((node, idx) => {
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        const category = resolveNodeCategoryLabel(node);
        const labelDecision = resolveNodeLabelDecision(node);
        return {
            id: node.id,
            type: 'custom',
            position: { x: col * cellW, y: row * cellH },
            data: {
                label: labelDecision.title,
                type: category,
                description: node.description ?? '',
                shape: node.shape,
                group: node.group,
                kind: node.kind,
                technology: node.technology,
                semanticRole: node.semanticRole,
                semanticType: node.semanticType,
                category,
                owner: node.owner,
                domain: node.domain,
                dataClassification: node.dataClassification,
                securityLevel: node.securityLevel,
                compliance: node.compliance,
                criticality: node.criticality,
                trust: node.trust,
                businessMeaning: node.businessMeaning,
                technicalMeaning: node.technicalMeaning,
            subtitle: labelDecision.subtitle,
            fullLabel: node.label,
            labelTooltip: labelDecision.tooltip,
            },
        };
    });
    const ids = new Set(ir.nodes.map((n) => n.id));
    const edges: Edge[] = ir.edges
        .filter((e) => ids.has(e.source) && ids.has(e.target))
        .map((e) => buildEdge(ir, e));
    return { nodes, edges: assignEdgeAnchors(nodes, edges) };
}

function buildNode(ir: DiagramIR, node: DiagramIRNode, layout: LayoutResult): Node {
    const pos = layout.positions.get(node.id);
    // Human-readable category badge — replaces the raw `node.kind` (which the
    // AI sometimes emits as the literal string `"Generic"`, producing the
    // misleading "GENERIC" pill that bled through every node card).
    const category = resolveNodeCategoryLabel(node);
    const audience = ir.metadata?.audience ?? 'technical';
    const hierarchy = resolveNodeHierarchy(ir, node, audience);
    const labelDecision = resolveNodeLabelDecision(node);
    return {
        id: node.id,
        type: 'custom',
        position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
        data: {
            // Content-adaptive card size: matches the box the layout engine
            // reserved for this node so what dagre planned is what
            // CustomNode paints.
            width: pos?.width,
            height: pos?.height,
            label: labelDecision.title,
            // `type` powers the small pill rendered under the title. We keep
            // the legacy field name for backward compatibility with custom
            // node implementations that still inspect `data.type`.
            type: category,
            description: node.description ?? '',
            shape: node.shape,
            group: node.group,
            kind: node.kind,
            technology: node.technology,
            semanticRole: node.semanticRole,
            // Ship the semantic type and human category through so the
            // inspector, legend, and tooltip can read them without re-running
            // the resolver.
            semanticType: node.semanticType,
            category,
            // Phase 2: expose extended governance metadata so the inspector
            // can render it AND so the round-trip back to IR via
            // `toDiagramIR` can recover the same fields.
            owner: node.owner,
            domain: node.domain,
            dataClassification: node.dataClassification,
            securityLevel: node.securityLevel,
            compliance: node.compliance,
            criticality: node.criticality,
            trust: node.trust,
            businessMeaning: node.businessMeaning,
            technicalMeaning: node.technicalMeaning,
            subtitle: labelDecision.subtitle,
            fullLabel: node.label,
            labelTooltip: labelDecision.tooltip,
            tags: node.tags,
            badge: node.badge,
            status: node.status,
            icon: node.icon,
            hierarchyLevel: hierarchy.level,
            hierarchyEmphasis: hierarchy.emphasis,
            hideByDefault: hierarchy.hideByDefault,
        },
    };
}

function buildEdge(ir: DiagramIR, edge: DiagramIREdge): Edge {
    const relation: EdgeRelationKey = (edge.relation ?? 'default') as EdgeRelationKey;
    const marker = MARKER_TOKENS[relation] ?? MARKER_TOKENS.default;
    const routing = resolveEdgeRoutingDecision(ir, edge);
    const audience = ir.metadata?.audience ?? 'technical';
    const hierarchy = resolveEdgeHierarchy(ir, edge, audience);
    const labelDecision = resolveEdgeLabelDecision(edge);
    const protocol = edge.protocol && edge.protocol.trim().length > 0
        ? edge.protocol.trim()
        : resolveEdgeCategoryLabel({
            protocol: edge.protocol,
            semanticType: edge.semanticType,
            relation: edge.relation,
            label: labelDecision.visibleLabel,
        }) ?? undefined;
    return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'custom',
        label: labelDecision.visibleLabel,
        markerEnd: {
            type: (marker.type === 'arrow' ? 'arrow' : 'arrowclosed') as MarkerType,
            width: marker.width,
            height: marker.height,
        },
        data: {
            edgeType: edge.relation && edge.relation !== 'default' ? edge.relation : undefined,
            protocol: labelDecision.protocolBadge ?? protocol,
            routingStyle: routing.preferredStyle,
            laneAware: routing.laneAware,
            avoidCrossBoundary: routing.avoidCrossBoundary,
            visualPriority: routing.visualPriority,
            hierarchyLevel: hierarchy.level,
            hierarchyEmphasis: hierarchy.emphasis,
            hideByDefault: hierarchy.hideByDefault,
            // Surface the rest of the edge IR metadata to the renderer so the
            // inspector can show direction, criticality, sensitivity, and the
            // semantic intent without re-parsing the IR.
            direction: edge.direction,
            criticality: edge.criticality,
            dataSensitivity: edge.dataSensitivity,
            retryPolicy: edge.retryPolicy,
            semanticType: edge.semanticType,
            // Animation hint: the IR may explicitly request animation (e.g.
            // for narrative emphasis). Falls back to the relation-based rule
            // inside CustomEdge.
            animated: edge.animated,
            // Phase 2 extended edge metadata. CustomEdge surfaces a subset
            // as badges (sensitivity, security, retry, frequency) and the
            // inspector renders the rest.
            frequency: edge.frequency,
            synchrony: edge.synchrony,
            security: edge.security,
            payload: edge.payload,
            trust: edge.trust,
            businessMeaning: edge.businessMeaning,
            technicalMeaning: edge.technicalMeaning,
            observability: edge.observability,
            sla: edge.sla,
            errorHandling: edge.errorHandling,
            fullLabel: edge.label,
            labelTooltip: labelDecision.tooltip,
        },
    };
}

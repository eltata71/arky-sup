/**
 * Layout-aware quality service.
 *
 * The existing `diagramVisualLints.ts` reasons about *intended* spatial
 * relationships via `pseudoLayoutForLints` (a deterministic grid). That is
 * the right answer when we don't have positions yet, but once dagre / ELK
 * has produced real coordinates we can be much more precise:
 *
 *   - actual bounding box of the content (used to size exports)
 *   - aspect-ratio sparsity (real ratio, not the grid approximation)
 *   - node-to-node overlap risk (positions + canonical node size)
 *   - edge-label proximity using true midpoints
 *   - export crop risk: nodes outside a reasonable padded canvas
 *
 * This module produces a `LayoutQualityMetrics` payload that other
 * services (`analyzeDiagramQuality`, `buildDiagramPreflightReport`, the
 * export modal) can consume. Pure / synchronous — no DOM, no React, no
 * mutation of the input.
 *
 * The function tolerates empty positions: it simply returns zeroed metrics
 * so callers can branch on `hasLayout` instead of guarding every field.
 */

import type { DiagramIR } from '../../lib/diagram';
import { LAYOUT_PRESETS } from '../../lib/diagramTokens';
import type { VisualLintIssue } from './diagramVisualLints';

export interface NodeRect {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface GroupRect {
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** When provided, used to validate boundary containment. */
    memberIds?: string[];
}

export interface BoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface ViewportRect extends BoundingBox {}

export interface FloatingObstacleRect extends BoundingBox {
    /** Human-readable label (toolbar, inspector, …) surfaced in the lint message. */
    label?: string;
}

export interface EdgeSegment {
    id: string;
    source: string;
    target: string;
    /** True positions in canvas coordinates. */
    waypoints: Array<{ x: number; y: number }>;
}

export interface LayoutQualityMetrics {
    hasLayout: boolean;
    nodeCount: number;
    boundingBox: BoundingBox;
    aspectRatio: number;
    /** Fraction of the bounding box covered by node rectangles. */
    density: number;
    /** Pairs of nodes whose rectangles overlap. */
    overlappingNodePairs: Array<{ a: string; b: string }>;
    /** Pairs of labeled edges with midpoints closer than the collision radius. */
    edgeLabelCollisions: Array<{ a: string; b: string; distance: number }>;
    /** Nodes whose label is likely to overflow the card width. */
    overflowingLabels: string[];
    /** Edges that visually cross other edges (rough segment-intersect heuristic). */
    edgeCrossings: number;
    /** True when the bounding box is wider/taller than 3× its smaller side. */
    aspectStrip: 'horizontal' | 'vertical' | null;
    /** Risk that the export will crop content because nodes touch the edge. */
    exportCropRisk: 'none' | 'low' | 'medium' | 'high';
    // ── Gap 5: extra visual checks ────────────────────────────────────────
    /** Pairs of group zones that visually overlap. */
    overlappingGroupPairs: Array<{ a: string; b: string }>;
    /** Group → list of member node ids whose rectangle escapes the boundary. */
    boundaryContainmentBreaches: Array<{ groupId: string; nodeIds: string[] }>;
    /** Nodes whose rect lies fully outside the supplied viewport. */
    nodesOutsideViewport: string[];
    /** Edges whose segments pass through a non-endpoint node rectangle. */
    edgesCrossingNodes: Array<{ edgeId: string; throughNodeIds: string[] }>;
    /** Nodes hidden by a floating obstacle (toolbar, inspector, minimap). */
    nodesObscuredByObstacles: Array<{ nodeId: string; obstacle: string }>;
    /** True when the bounding box leaves more than 65% of the viewport empty. */
    excessiveEmptySpace: boolean;
    /** True when the bounding box overflows the safe export area (recortes). */
    exportClipRisk: boolean;
}

const COLLISION_RADIUS_PX = 96;
const EXPORT_PADDING_PX = 24;
const NODE_LABEL_OVERFLOW = 32;

function emptyMetrics(): LayoutQualityMetrics {
    return {
        hasLayout: false,
        nodeCount: 0,
        boundingBox: { x: 0, y: 0, width: 0, height: 0 },
        aspectRatio: 1,
        density: 0,
        overlappingNodePairs: [],
        edgeLabelCollisions: [],
        overflowingLabels: [],
        edgeCrossings: 0,
        aspectStrip: null,
        exportCropRisk: 'none',
        overlappingGroupPairs: [],
        boundaryContainmentBreaches: [],
        nodesOutsideViewport: [],
        edgesCrossingNodes: [],
        nodesObscuredByObstacles: [],
        excessiveEmptySpace: false,
        exportClipRisk: false,
    };
}

function computeBoundingBox(rects: NodeRect[]): BoundingBox {
    if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of rects) {
        if (r.x < minX) minX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.x + r.width  > maxX) maxX = r.x + r.width;
        if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
    return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function rectsOverlap(a: NodeRect, b: NodeRect): boolean {
    return (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
    );
}

function segmentsIntersect(
    a1: { x: number; y: number }, a2: { x: number; y: number },
    b1: { x: number; y: number }, b2: { x: number; y: number },
): boolean {
    const det = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
    if (det === 0) return false;
    const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / det;
    const u = ((b1.x - a1.x) * (a2.y - a1.y) - (b1.y - a1.y) * (a2.x - a1.x)) / det;
    return t > 0 && t < 1 && u > 0 && u < 1;
}

/**
 * Build a `NodeRect` snapshot from any source: positions Map (from
 * `LayoutResult`), ReactFlow nodes with `position`, or an arbitrary record.
 * Missing dimensions fall back to the canonical flow preset.
 */
export function nodesToRects(
    nodes: Array<{ id: string; position?: { x: number; y: number }; width?: number; height?: number; data?: unknown }>,
): NodeRect[] {
    const W = LAYOUT_PRESETS.flow.node.width;
    const H = LAYOUT_PRESETS.flow.node.height;
    return nodes
        .filter((n) => n.position && Number.isFinite(n.position.x) && Number.isFinite(n.position.y))
        .map((n) => ({
            id: String(n.id),
            x: n.position!.x,
            y: n.position!.y,
            width: Number.isFinite(n.width) ? (n.width as number) : W,
            height: Number.isFinite(n.height) ? (n.height as number) : H,
        }));
}

export interface LayoutQualityInput {
    ir: DiagramIR;
    nodeRects: NodeRect[];
    /**
     * Gap 5: optional group rectangles. When provided, the service detects
     * group overlap, boundary-containment breaches and group-related
     * sparsity. Empty by default so the legacy call sites stay valid.
     */
    groupRects?: GroupRect[];
    /**
     * Optional viewport (canvas visible area). When provided, the service
     * detects nodes / labels that landed outside the visible region.
     */
    viewport?: ViewportRect;
    /**
     * Optional floating obstacles (toolbars, panels, minimap). Each is a
     * canvas-coordinate rectangle that *covers* part of the canvas; the
     * service flags any node whose rect intersects an obstacle.
     */
    floatingObstacles?: FloatingObstacleRect[];
    /**
     * Optional edge waypoints (from ELK/Dagre routing). When provided, the
     * crossing heuristic uses polylines instead of straight segments.
     */
    edgeSegments?: EdgeSegment[];
}

export function computeLayoutQuality(input: LayoutQualityInput): LayoutQualityMetrics {
    const { ir, nodeRects, groupRects = [], viewport, floatingObstacles = [], edgeSegments } = input;
    if (nodeRects.length === 0) return emptyMetrics();

    const bbox = computeBoundingBox(nodeRects);
    if (bbox.width <= 0 || bbox.height <= 0) return { ...emptyMetrics(), nodeCount: nodeRects.length };

    const aspectRatio = Math.max(bbox.width, bbox.height) / Math.max(1, Math.min(bbox.width, bbox.height));
    const aspectStrip: 'horizontal' | 'vertical' | null = aspectRatio >= 3
        ? (bbox.width >= bbox.height ? 'horizontal' : 'vertical')
        : null;

    const nodeArea = nodeRects.reduce((acc, r) => acc + r.width * r.height, 0);
    const density = bbox.width * bbox.height > 0
        ? Math.min(1, nodeArea / (bbox.width * bbox.height))
        : 0;

    // Overlap detection — O(n²) is fine for the diagram sizes we ship
    // (<100 nodes by convention).
    const overlappingNodePairs: Array<{ a: string; b: string }> = [];
    for (let i = 0; i < nodeRects.length; i++) {
        for (let j = i + 1; j < nodeRects.length; j++) {
            if (rectsOverlap(nodeRects[i], nodeRects[j])) {
                overlappingNodePairs.push({ a: nodeRects[i].id, b: nodeRects[j].id });
            }
        }
    }

    // Edge label collisions — true midpoints from real positions.
    const rectById = new Map(nodeRects.map((r) => [r.id, r] as const));
    type LabeledEdge = { id: string; midX: number; midY: number };
    const labeled: LabeledEdge[] = [];
    for (const edge of ir.edges) {
        if (!edge.label || edge.label.trim().length === 0) continue;
        const s = rectById.get(edge.source);
        const t = rectById.get(edge.target);
        if (!s || !t) continue;
        labeled.push({
            id: edge.id,
            midX: (s.x + s.width / 2 + t.x + t.width / 2) / 2,
            midY: (s.y + s.height / 2 + t.y + t.height / 2) / 2,
        });
    }
    const edgeLabelCollisions: Array<{ a: string; b: string; distance: number }> = [];
    for (let i = 0; i < labeled.length; i++) {
        for (let j = i + 1; j < labeled.length; j++) {
            const a = labeled[i], b = labeled[j];
            const dx = a.midX - b.midX;
            const dy = a.midY - b.midY;
            const d = Math.hypot(dx, dy);
            if (d < COLLISION_RADIUS_PX) edgeLabelCollisions.push({ a: a.id, b: b.id, distance: d });
        }
    }

    // Label-overflow heuristic — based on the IR labels (positions don't
    // matter for the text length itself).
    const overflowingLabels = ir.nodes
        .filter((n) => (n.label ?? '').length > NODE_LABEL_OVERFLOW)
        .map((n) => n.id);

    // Edge-crossing heuristic — when ELK/Dagre supplies waypoints we walk
    // each polyline segment so curved/orthogonal routes are evaluated;
    // otherwise we fall back to a straight segment between source and
    // target centers. We only count actual crossings (segments that share
    // endpoints count as 0). This is rough but useful for high-density
    // diagrams.
    let edgeCrossings = 0;
    type StraightSeg = {
        id: string;
        source: string;
        target: string;
        polyline: Array<{ x: number; y: number }>;
    };
    const segments: StraightSeg[] = ir.edges
        .map((e) => {
            const s = rectById.get(e.source);
            const t = rectById.get(e.target);
            if (!s || !t) return null;
            const supplied = edgeSegments?.find((seg) => seg.id === e.id);
            const polyline = supplied && supplied.waypoints.length >= 2
                ? supplied.waypoints
                : [
                    { x: s.x + s.width / 2, y: s.y + s.height / 2 },
                    { x: t.x + t.width / 2, y: t.y + t.height / 2 },
                ];
            return { id: e.id, source: e.source, target: e.target, polyline };
        })
        .filter((s): s is StraightSeg => s !== null);

    const segmentPairs = (poly: Array<{ x: number; y: number }>) => {
        const out: Array<[{ x: number; y: number }, { x: number; y: number }]> = [];
        for (let k = 0; k + 1 < poly.length; k++) out.push([poly[k], poly[k + 1]]);
        return out;
    };

    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            const a = segments[i], b = segments[j];
            if (a.source === b.source || a.source === b.target || a.target === b.source || a.target === b.target) continue;
            const aSegs = segmentPairs(a.polyline);
            const bSegs = segmentPairs(b.polyline);
            outer:
            for (const [a1, a2] of aSegs) {
                for (const [b1, b2] of bSegs) {
                    if (segmentsIntersect(a1, a2, b1, b2)) { edgeCrossings += 1; break outer; }
                }
            }
        }
    }

    // ── Gap 5: extra visual checks ────────────────────────────────────────

    // Group zone overlap (only when the group rects exclude each other in
    // the diagram — overlapping zones confuse the boundary semantics).
    const overlappingGroupPairs: Array<{ a: string; b: string }> = [];
    for (let i = 0; i < groupRects.length; i++) {
        for (let j = i + 1; j < groupRects.length; j++) {
            if (rectsOverlap(groupRects[i] as NodeRect, groupRects[j] as NodeRect)) {
                overlappingGroupPairs.push({ a: groupRects[i].id, b: groupRects[j].id });
            }
        }
    }

    // Boundary containment: every node that the IR assigns to a group MUST
    // sit inside the group's rectangle. When the rect is omitted from the
    // member list we cross-reference the IR (`node.group === group.label`).
    const boundaryContainmentBreaches: Array<{ groupId: string; nodeIds: string[] }> = [];
    for (const gr of groupRects) {
        const memberIds = gr.memberIds && gr.memberIds.length > 0
            ? gr.memberIds
            : ir.nodes.filter((n) => (n.group ?? '').toLowerCase() === gr.label.toLowerCase()).map((n) => n.id);
        const breaches: string[] = [];
        for (const id of memberIds) {
            const rect = rectById.get(id);
            if (!rect) continue;
            const fullyInside =
                rect.x >= gr.x
                && rect.y >= gr.y
                && rect.x + rect.width <= gr.x + gr.width
                && rect.y + rect.height <= gr.y + gr.height;
            if (!fullyInside) breaches.push(id);
        }
        if (breaches.length > 0) boundaryContainmentBreaches.push({ groupId: gr.id, nodeIds: breaches });
    }

    // Nodes (and their labels) outside the supplied viewport.
    const nodesOutsideViewport: string[] = viewport
        ? nodeRects.filter((r) => (
            r.x + r.width < viewport.x
            || r.y + r.height < viewport.y
            || r.x > viewport.x + viewport.width
            || r.y > viewport.y + viewport.height
        )).map((r) => r.id)
        : [];

    // Edges that cross a node rectangle that is NEITHER source NOR target.
    const edgesCrossingNodes: Array<{ edgeId: string; throughNodeIds: string[] }> = [];
    const nodeRectList = nodeRects;
    for (const seg of segments) {
        const through: string[] = [];
        for (const rect of nodeRectList) {
            if (rect.id === seg.source || rect.id === seg.target) continue;
            // Treat the node rect as four edges and test against every
            // polyline segment. If any segment intersects, the edge passes
            // through the node visually.
            const corners: Array<[{ x: number; y: number }, { x: number; y: number }]> = [
                [{ x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }],
                [{ x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }],
                [{ x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }],
                [{ x: rect.x, y: rect.y + rect.height }, { x: rect.x, y: rect.y }],
            ];
            const polySegs = segmentPairs(seg.polyline);
            let hit = false;
            outerEdge:
            for (const [p1, p2] of polySegs) {
                for (const [c1, c2] of corners) {
                    if (segmentsIntersect(p1, p2, c1, c2)) { hit = true; break outerEdge; }
                }
            }
            if (hit) through.push(rect.id);
        }
        if (through.length > 0) edgesCrossingNodes.push({ edgeId: seg.id, throughNodeIds: through });
    }

    // Nodes hidden by toolbars/panels/minimap.
    const nodesObscuredByObstacles: Array<{ nodeId: string; obstacle: string }> = [];
    for (const obstacle of floatingObstacles) {
        for (const rect of nodeRects) {
            if (rectsOverlap(rect, obstacle as NodeRect)) {
                nodesObscuredByObstacles.push({ nodeId: rect.id, obstacle: obstacle.label ?? 'panel' });
            }
        }
    }

    // Excessive empty space — content occupies less than 35% of the viewport
    // area. Only checked when a viewport is provided (e.g. during export).
    const excessiveEmptySpace = viewport && viewport.width > 0 && viewport.height > 0
        ? (bbox.width * bbox.height) / (viewport.width * viewport.height) < 0.35
        : false;

    // Export clip risk: content overflows the viewport, OR labels / badges
    // sit too close to the bounding box edge (already approximated by the
    // existing `exportCropRisk` band). We tighten the criterion when a
    // viewport is provided.
    const exportClipRisk = viewport
        ? (bbox.x < viewport.x || bbox.y < viewport.y
            || bbox.x + bbox.width > viewport.x + viewport.width
            || bbox.y + bbox.height > viewport.y + viewport.height)
        : false;

    // Export crop risk — nodes that sit close to the edge of the bounding
    // box trigger cropping when the export viewport ignores padding.
    const margin = EXPORT_PADDING_PX;
    let edgeProximity = 0;
    for (const rect of nodeRects) {
        const distLeft   = rect.x - bbox.x;
        const distTop    = rect.y - bbox.y;
        const distRight  = (bbox.x + bbox.width)  - (rect.x + rect.width);
        const distBottom = (bbox.y + bbox.height) - (rect.y + rect.height);
        if (distLeft < margin || distTop < margin || distRight < margin || distBottom < margin) edgeProximity += 1;
    }
    const ratio = edgeProximity / nodeRects.length;
    const exportCropRisk: LayoutQualityMetrics['exportCropRisk'] = ratio >= 0.5
        ? 'high'
        : ratio >= 0.25
            ? 'medium'
            : ratio > 0
                ? 'low'
                : 'none';

    return {
        hasLayout: true,
        nodeCount: nodeRects.length,
        boundingBox: bbox,
        aspectRatio,
        density,
        overlappingNodePairs,
        edgeLabelCollisions,
        overflowingLabels,
        edgeCrossings,
        aspectStrip,
        exportCropRisk,
        overlappingGroupPairs,
        boundaryContainmentBreaches,
        nodesOutsideViewport,
        edgesCrossingNodes,
        nodesObscuredByObstacles,
        excessiveEmptySpace,
        exportClipRisk,
    };
}

/**
 * Convert layout quality metrics into the standard `VisualLintIssue`
 * shape so they can be merged into `analyzeDiagramQuality`. Each finding
 * is severity-capped according to user impact:
 *  - overlap          → high (you literally cannot read the diagram)
 *  - heavy collisions → medium
 *  - aspect strip     → medium
 *  - export crop risk → medium-low depending on band
 *  - many edge crossings → low
 */
export function layoutMetricsToLints(metrics: LayoutQualityMetrics): VisualLintIssue[] {
    if (!metrics.hasLayout || metrics.nodeCount === 0) return [];
    const out: VisualLintIssue[] = [];

    if (metrics.overlappingNodePairs.length > 0) {
        out.push({
            id: 'layout-node-overlap',
            code: 'VISUAL_NODE_OVERLAP_RISK',
            severity: 'high',
            message: `Hay ${metrics.overlappingNodePairs.length} par(es) de nodos visualmente superpuestos.`,
            recommendation: 'Aplica un layout más espacioso (ELK layered o mode "spacious") o desagrupa elementos densos.',
            affectedIds: Array.from(new Set(metrics.overlappingNodePairs.flatMap((p) => [p.a, p.b]))).slice(0, 10),
        });
    }
    if (metrics.edgeLabelCollisions.length > 0) {
        out.push({
            id: 'layout-edge-label-collisions',
            code: 'VISUAL_EDGE_LABEL_COLLISION',
            severity: 'medium',
            message: `${metrics.edgeLabelCollisions.length} colisión(es) de etiquetas detectadas sobre las posiciones reales.`,
            recommendation: 'Aumenta el espaciado entre nodos o acorta las etiquetas afectadas.',
            affectedIds: Array.from(new Set(metrics.edgeLabelCollisions.flatMap((p) => [p.a, p.b]))).slice(0, 10),
        });
    }
    if (metrics.aspectStrip) {
        out.push({
            id: 'layout-aspect-strip',
            code: 'VISUAL_SPARSE_LAYOUT',
            severity: 'medium',
            message: `El layout final es una tira ${metrics.aspectStrip} (ratio ${metrics.aspectRatio.toFixed(1)}:1).`,
            recommendation: `Cambia la dirección a ${metrics.aspectStrip === 'horizontal' ? 'top-down (TB)' : 'horizontal (LR)'} o agrega carriles para llenar el canvas.`,
        });
    }
    if (metrics.exportCropRisk === 'high' || metrics.exportCropRisk === 'medium') {
        out.push({
            id: 'layout-export-crop-risk',
            code: 'VISUAL_LEGEND_NOISY',
            severity: metrics.exportCropRisk === 'high' ? 'medium' : 'low',
            message: `Riesgo de recorte en exportación: muchos nodos quedaron contra el borde del bounding box.`,
            recommendation: 'Aumenta el padding de exportación (la frame nueva ya añade margen automático), o aplica fitView antes de exportar.',
        });
    }
    if (metrics.edgeCrossings >= Math.max(6, Math.ceil(metrics.nodeCount * 0.8))) {
        out.push({
            id: 'layout-edge-crossings',
            code: 'VISUAL_DENSITY_VARIANCE',
            severity: 'low',
            message: `Hay ${metrics.edgeCrossings} cruces de aristas en el layout actual.`,
            recommendation: 'Prueba con ELK layered + ruteo ortogonal para reducir cruces, o reorganiza grupos.',
        });
    }
    if (metrics.overflowingLabels.length > 0) {
        out.push({
            id: 'layout-label-overflow',
            code: 'VISUAL_LABEL_OVERFLOW',
            severity: 'low',
            message: `${metrics.overflowingLabels.length} nodo(s) tienen etiquetas más largas que el ancho del card.`,
            recommendation: 'Acorta a ≤ 24 caracteres o mueve el detalle al campo de descripción.',
            affectedIds: metrics.overflowingLabels.slice(0, 10),
        });
    }
    // ── Gap 5: extra lints ────────────────────────────────────────────────
    if (metrics.overlappingGroupPairs.length > 0) {
        out.push({
            id: 'layout-group-overlap',
            code: 'VISUAL_GROUP_OVERLAP',
            severity: 'high',
            message: `${metrics.overlappingGroupPairs.length} par(es) de boundaries/grupos se superponen visualmente.`,
            recommendation: 'Aplica un layout más espacioso o separa los grupos en columnas/filas dedicadas.',
            affectedIds: Array.from(new Set(metrics.overlappingGroupPairs.flatMap((p) => [p.a, p.b]))).slice(0, 10),
        });
    }
    if (metrics.boundaryContainmentBreaches.length > 0) {
        const stray = metrics.boundaryContainmentBreaches.reduce((acc, b) => acc + b.nodeIds.length, 0);
        out.push({
            id: 'layout-boundary-containment',
            code: 'VISUAL_BOUNDARY_BREACH',
            severity: 'high',
            message: `${stray} nodo(s) escapan del boundary visual de su grupo (${metrics.boundaryContainmentBreaches.length} grupo(s) afectados).`,
            recommendation: 'Re-aplica ELK layered con grupos como compound nodes o ajusta manualmente las posiciones; el grupo debe contener a todos sus miembros.',
            affectedIds: metrics.boundaryContainmentBreaches.flatMap((b) => b.nodeIds).slice(0, 10),
        });
    }
    if (metrics.nodesOutsideViewport.length > 0) {
        out.push({
            id: 'layout-offscreen-nodes',
            code: 'VISUAL_OFFSCREEN_NODES',
            severity: 'medium',
            message: `${metrics.nodesOutsideViewport.length} nodo(s) quedaron fuera del viewport útil.`,
            recommendation: 'Pulsa "Centrar diagrama" o reduce la densidad — el viewport actual recorta contenido.',
            affectedIds: metrics.nodesOutsideViewport.slice(0, 10),
        });
    }
    if (metrics.edgesCrossingNodes.length > 0) {
        out.push({
            id: 'layout-edges-through-nodes',
            code: 'VISUAL_EDGES_THROUGH_NODES',
            severity: 'medium',
            message: `${metrics.edgesCrossingNodes.length} arista(s) atraviesan nodos que no son su origen ni destino.`,
            recommendation: 'Aplica ruteo ortogonal (ELK layered + orthogonal) o reubica los nodos en conflicto.',
            affectedIds: Array.from(new Set(metrics.edgesCrossingNodes.flatMap((e) => [e.edgeId, ...e.throughNodeIds]))).slice(0, 10),
        });
    }
    if (metrics.nodesObscuredByObstacles.length > 0) {
        const obscured = Array.from(new Set(metrics.nodesObscuredByObstacles.map((o) => o.nodeId)));
        out.push({
            id: 'layout-obscured-by-panels',
            code: 'VISUAL_OBSCURED_BY_PANELS',
            severity: 'medium',
            message: `${obscured.length} nodo(s) están ocultos por toolbars o paneles flotantes.`,
            recommendation: 'Cierra el inspector o redimensiona los paneles antes de exportar — la exportación con frame ya excluye toolbars, pero la lectura en pantalla queda comprometida.',
            affectedIds: obscured.slice(0, 10),
        });
    }
    if (metrics.excessiveEmptySpace) {
        out.push({
            id: 'layout-excess-empty-space',
            code: 'VISUAL_EXCESS_WHITESPACE',
            severity: 'low',
            message: 'El contenido ocupa menos del 35% del viewport: la exportación tendrá demasiado espacio vacío.',
            recommendation: 'Aplica densidad compact, fitView antes de exportar, o usa el bounding-box export para recortar el área útil.',
        });
    }
    if (metrics.exportClipRisk) {
        out.push({
            id: 'layout-export-clip-risk',
            code: 'VISUAL_EXPORT_CLIP',
            severity: 'high',
            message: 'El contenido excede el viewport: la exportación recortará labels, badges o boundaries.',
            recommendation: 'Aumenta el padding del bounding box o reduce densidad antes de exportar.',
        });
    }
    return out;
}

/**
 * Bounding box for an EXPORT operation. Adds a configurable padding so
 * labels, badges and boundaries are never clipped. Returns a viewport
 * payload suitable for `fitBounds` / canvas cropping.
 */
export function computeExportBounds(nodeRects: NodeRect[], paddingPx = 48): BoundingBox {
    const bbox = computeBoundingBox(nodeRects);
    if (bbox.width <= 0 || bbox.height <= 0) return bbox;
    return {
        x: bbox.x - paddingPx,
        y: bbox.y - paddingPx,
        width: bbox.width + paddingPx * 2,
        height: bbox.height + paddingPx * 2,
    };
}

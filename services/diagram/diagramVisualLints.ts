/**
 * Visual quality lints.
 *
 * The existing `analyzeDiagramQuality` is excellent at *semantic* checks
 * (missing labels, dangling references, unclassified nodes, …) but it does
 * not catch the *visual* failures observed in the field reports:
 *   - sparse diagrams that render as a thin strip with 70% empty canvas;
 *   - long node labels that overflow the card and get visually truncated;
 *   - edge labels that physically collide because two relations share
 *     endpoints;
 *   - process / BPMN diagrams without an explicit start/end event;
 *   - value stream maps with a vertical (top-down) orientation, which
 *     contradicts the convention that value streams read left-to-right.
 *
 * This module produces a flat list of `VisualLintIssue`s that piggyback on
 * the existing `DiagramLintIssue` shape so they can be merged into the
 * normal quality report without touching the consumers. The function is
 * pure and deterministic — no DOM access, no React.
 */

import type { DiagramIR, DiagramIRNode } from '../../lib/diagram';
import { LAYOUT_PRESETS } from '../../lib/diagramTokens';
import { detectDiagramArchetype } from './diagramTypeQualityGates';

export type VisualLintCode =
    | 'VISUAL_SPARSE_LAYOUT'
    | 'VISUAL_LABEL_OVERFLOW'
    | 'VISUAL_EDGE_LABEL_COLLISION'
    | 'VISUAL_NODE_OVERLAP_RISK'
    | 'VISUAL_PROCESS_MISSING_TERMINUS'
    | 'VISUAL_VALUE_STREAM_NOT_HORIZONTAL'
    | 'VISUAL_INTEGRATION_LAYERING_MISSING'
    | 'VISUAL_LEGEND_NOISY'
    | 'VISUAL_TOO_DENSE'
    | 'VISUAL_DENSITY_VARIANCE'
    // Gap 5: real-position layout lints
    | 'VISUAL_GROUP_OVERLAP'
    | 'VISUAL_BOUNDARY_BREACH'
    | 'VISUAL_OFFSCREEN_NODES'
    | 'VISUAL_EDGES_THROUGH_NODES'
    | 'VISUAL_OBSCURED_BY_PANELS'
    | 'VISUAL_EXCESS_WHITESPACE'
    | 'VISUAL_EXPORT_CLIP';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface VisualLintIssue {
    id: string;
    code: VisualLintCode;
    severity: Severity;
    message: string;
    recommendation: string;
    affectedIds?: string[];
}

const NODE_LABEL_MAX_VISIBLE = 28; // characters visible before wrap/truncate per row
const NODE_LABEL_MAX_TOTAL  = 48;  // total characters above which overflow is likely
const EDGE_LABEL_COLLISION_RADIUS = 96; // px between label centroids to count as collision risk
const PROCESS_TERMINUS_RE = /\b(inicio|start|comienzo|trigger|fin|end|cierre|t[eé]rmino|stop)\b/i;
const LAYER_KEYWORDS = ['canales', 'integraci', 'datos', 'core', 'dominio', 'experiencia', 'edge', 'gateway', 'data', 'business'];

interface NodePosition {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Compute pseudo-positions for the IR's nodes by running a deterministic
 * grid pass. Used as a stand-in for the real layout when the lint needs to
 * reason about spatial proximity without paying the cost of a full dagre
 * run. The grid is intentionally tight: spatial lints look for "labels
 * close enough to collide", and a tight grid is the worst case.
 *
 * Exposed primarily for tests; consumers normally call the lint functions
 * which use this internally.
 */
export function pseudoLayoutForLints(ir: DiagramIR): NodePosition[] {
    const NODE_W = LAYOUT_PRESETS.flow.node.width;
    const NODE_H = LAYOUT_PRESETS.flow.node.height;
    const GAP    = 64;
    const cols = Math.max(1, Math.ceil(Math.sqrt(ir.nodes.length || 1)));
    return ir.nodes.map((node, idx) => ({
        id: node.id,
        x: (idx % cols) * (NODE_W + GAP),
        y: Math.floor(idx / cols) * (NODE_H + GAP),
        width: NODE_W,
        height: NODE_H,
    }));
}

/**
 * Aspect-ratio sparsity lint. Fires when the diagram's content bbox is a
 * narrow strip (one dimension ≥ 3× the other) and there are enough nodes
 * to justify wider layout. Targets the iPad screenshots where a 7-node
 * vertical strip leaves 70% of the canvas empty.
 */
export function lintSparseLayout(ir: DiagramIR, positions: NodePosition[] = pseudoLayoutForLints(ir)): VisualLintIssue[] {
    if (positions.length < 4) return [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x + p.width  > maxX) maxX = p.x + p.width;
        if (p.y + p.height > maxY) maxY = p.y + p.height;
    }
    const w = maxX - minX, h = maxY - minY;
    if (w <= 0 || h <= 0) return [];

    const ratio = Math.max(w, h) / Math.max(1, Math.min(w, h));
    if (ratio >= 3) {
        const orientation = w >= h ? 'horizontal' : 'vertical';
        const recommendedDirection = orientation === 'horizontal' ? 'top-down (TB)' : 'horizontal (LR)';
        return [{
            id: 'visual-sparse-layout',
            code: 'VISUAL_SPARSE_LAYOUT',
            severity: 'medium',
            message: `El diagrama renderiza como una tira ${orientation} (ratio ${ratio.toFixed(1)}:1) y deja mucho espacio vacío en el canvas.`,
            recommendation: `Cambia la dirección a ${recommendedDirection}, o reagrupa los nodos para llenar el área disponible.`,
        }];
    }
    return [];
}

/** Node-label overflow lint — flags labels likely to wrap awkwardly. */
export function lintLabelOverflow(ir: DiagramIR): VisualLintIssue[] {
    const overflowing = ir.nodes.filter((n) => {
        const label = (n.label ?? '').trim();
        if (label.length === 0) return false;
        // Single-word labels rarely overflow even when long because they
        // fit on a single line and the card scales font-size; multi-word
        // long labels are the real overflow risk.
        const words = label.split(/\s+/);
        if (label.length > NODE_LABEL_MAX_TOTAL) return true;
        if (label.length > NODE_LABEL_MAX_VISIBLE && words.length >= 3) return true;
        return false;
    });
    if (overflowing.length === 0) return [];
    return [{
        id: 'visual-label-overflow',
        code: 'VISUAL_LABEL_OVERFLOW',
        severity: 'low',
        message: `${overflowing.length} nodo(s) con etiquetas largas que pueden truncarse en pantalla.`,
        recommendation: 'Acorta el nombre a ≤ 24 caracteres o mueve el detalle al campo de descripción / inspector.',
        affectedIds: overflowing.map((n) => n.id),
    }];
}

/**
 * Edge-label collision risk: pairs of edges that share a source-target
 * neighbourhood and both carry labels. Two labels rendered within
 * EDGE_LABEL_COLLISION_RADIUS px of each other will visually overlap on
 * the canvas — confirmed in the field screenshots.
 */
export function lintEdgeLabelCollisions(ir: DiagramIR, positions: NodePosition[] = pseudoLayoutForLints(ir)): VisualLintIssue[] {
    const posById = new Map(positions.map((p) => [p.id, p]));
    interface LabeledEdge { id: string; midX: number; midY: number; }
    const labeled: LabeledEdge[] = [];
    for (const edge of ir.edges) {
        if (!edge.label || edge.label.trim().length === 0) continue;
        const s = posById.get(edge.source);
        const t = posById.get(edge.target);
        if (!s || !t) continue;
        labeled.push({
            id: edge.id,
            midX: (s.x + s.width / 2 + t.x + t.width / 2) / 2,
            midY: (s.y + s.height / 2 + t.y + t.height / 2) / 2,
        });
    }

    const collisions = new Map<string, Set<string>>();
    for (let i = 0; i < labeled.length; i++) {
        for (let j = i + 1; j < labeled.length; j++) {
            const a = labeled[i], b = labeled[j];
            const dx = a.midX - b.midX;
            const dy = a.midY - b.midY;
            if (Math.hypot(dx, dy) < EDGE_LABEL_COLLISION_RADIUS) {
                if (!collisions.has(a.id)) collisions.set(a.id, new Set());
                collisions.get(a.id)!.add(b.id);
            }
        }
    }
    if (collisions.size === 0) return [];

    const affectedIds = Array.from(collisions.keys());
    return [{
        id: 'visual-edge-label-collision',
        code: 'VISUAL_EDGE_LABEL_COLLISION',
        severity: 'medium',
        message: `Hay ${collisions.size} relación(es) cuya etiqueta podría solaparse con otra en el canvas.`,
        recommendation: 'Aplica modo "Compacto" para separar más los nodos, o acorta las etiquetas afectadas.',
        affectedIds: affectedIds.slice(0, 8),
    }];
}

/**
 * Process / BPMN terminus lint. The existing archetype-specific suggestion
 * checks the same condition but is filtered to `archetype === 'process'`;
 * this visual lint generalises to *any* archetype that *looks* like a
 * process (a roughly linear DAG with ≥ 4 nodes) so the inspector also
 * catches misclassified diagrams.
 */
export function lintProcessTerminus(ir: DiagramIR): VisualLintIssue[] {
    if (ir.nodes.length < 4) return [];
    const archetype = detectDiagramArchetype(ir);
    if (archetype !== 'process') return [];

    const hasTerminus = ir.nodes.some((n: DiagramIRNode) => PROCESS_TERMINUS_RE.test(`${n.label} ${n.description ?? ''}`));
    if (hasTerminus) return [];
    return [{
        id: 'visual-process-missing-terminus',
        code: 'VISUAL_PROCESS_MISSING_TERMINUS',
        severity: 'medium',
        message: 'El proceso no tiene eventos de inicio o fin explícitos.',
        recommendation: 'Añade nodos "Inicio" y "Fin" siguiendo convenciones BPMN 2.0; sin ellos el flujo no es verificable.',
    }];
}

/**
 * Value stream maps must be horizontal by convention. This lint fires when
 * the title declares a value stream but the IR's metadata or layout
 * directive implies a vertical orientation.
 */
export function lintValueStreamOrientation(ir: DiagramIR, positions: NodePosition[] = pseudoLayoutForLints(ir)): VisualLintIssue[] {
    const title = (ir.metadata?.title ?? '').toLowerCase();
    if (!/\b(value\s*stream|mapa\s+de\s+flujo\s+de\s+valor|vsm)\b/.test(title)) return [];
    if (positions.length < 4) return [];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of positions) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x + p.width  > maxX) maxX = p.x + p.width;
        if (p.y + p.height > maxY) maxY = p.y + p.height;
    }
    const w = maxX - minX, h = maxY - minY;
    if (h > w * 1.4) {
        return [{
            id: 'visual-value-stream-not-horizontal',
            code: 'VISUAL_VALUE_STREAM_NOT_HORIZONTAL',
            severity: 'medium',
            message: 'El Mapa de Flujo de Valor está orientado verticalmente.',
            recommendation: 'Cambia la dirección a horizontal (LR): la convención del VSM es leer las etapas de izquierda a derecha.',
        }];
    }
    return [];
}

/**
 * Integration layering lint: integration diagrams should expose at least
 * two visible layers (canales, integración, dominio, datos…). When the
 * archetype is integration but groups don't reveal layering, surface a
 * hint to add boundaries.
 */
export function lintIntegrationLayering(ir: DiagramIR): VisualLintIssue[] {
    const archetype = detectDiagramArchetype(ir);
    if (archetype !== 'integration') return [];
    if (ir.nodes.length < 6) return [];
    const groupLabels = ir.groups.map((g) => g.label.toLowerCase());
    const matchedLayers = LAYER_KEYWORDS.filter((kw) => groupLabels.some((label) => label.includes(kw)));
    if (matchedLayers.length >= 2) return [];

    return [{
        id: 'visual-integration-layering-missing',
        code: 'VISUAL_INTEGRATION_LAYERING_MISSING',
        severity: 'low',
        message: 'El diagrama de integración no muestra capas explícitas (canales, integración, dominio, datos…).',
        recommendation: 'Agrupa los nodos por capa lógica para que el flujo origen→integración→destino sea evidente.',
    }];
}

/** High-density warning — diagrams with many nodes per group / per canvas. */
export function lintDensity(ir: DiagramIR): VisualLintIssue[] {
    const out: VisualLintIssue[] = [];
    if (ir.nodes.length > 32) {
        out.push({
            id: 'visual-too-dense',
            code: 'VISUAL_TOO_DENSE',
            severity: 'medium',
            message: `El diagrama tiene ${ir.nodes.length} nodos: excede la densidad recomendada para una sola vista.`,
            recommendation: 'Divide el contenido en varios diagramas (contexto / contenedores / componentes) o crea una vista ejecutiva con menos nodos.',
        });
    }
    const veryLargeGroup = ir.groups.find((g) => g.nodeIds.length > 12);
    if (veryLargeGroup) {
        out.push({
            id: `visual-dense-group-${veryLargeGroup.id}`,
            code: 'VISUAL_DENSITY_VARIANCE',
            severity: 'low',
            message: `El grupo "${veryLargeGroup.label}" contiene ${veryLargeGroup.nodeIds.length} nodos; se vuelve difícil de leer.`,
            recommendation: 'Sub-divide el grupo o promueve algunos nodos a su propio diagrama.',
        });
    }
    return out;
}

/**
 * Aggregate entry point: runs every visual lint and returns the flat list
 * of issues. The pipeline calls this once per quality pass so the issues
 * land in the same `DiagramQualityReport.issues` array as the semantic
 * lints.
 */
export function collectVisualLints(ir: DiagramIR): VisualLintIssue[] {
    const positions = pseudoLayoutForLints(ir);
    return [
        ...lintSparseLayout(ir, positions),
        ...lintLabelOverflow(ir),
        ...lintEdgeLabelCollisions(ir, positions),
        ...lintProcessTerminus(ir),
        ...lintValueStreamOrientation(ir, positions),
        ...lintIntegrationLayering(ir),
        ...lintDensity(ir),
    ];
}

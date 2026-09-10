import type { DiagramIR } from '../../../lib/diagram';
import { buildArchetypeSuggestions, detectDiagramArchetype } from '../diagramTypeQualityGates';
import { collectVisualLints, type VisualLintIssue } from '../diagramVisualLints';
import {
    computeLayoutQuality,
    layoutMetricsToLints,
    type LayoutQualityMetrics,
    type NodeRect,
    type GroupRect,
    type ViewportRect,
    type FloatingObstacleRect,
    type EdgeSegment,
} from '../layoutQualityService';
import { runVisualQualityGate } from '../visualQualityGate';
import { validateBPMN, type BpmnValidationIssue } from '../bpmnValidation';
import { validateHealthcareCompliance, isHealthcareContext, type HealthcareComplianceIssue } from '../healthcareCompliance';
import { validateC4, type C4ValidationIssue } from '../c4Validation';
import { inferDiagramType } from '../diagramTypeInference';

/**
 * The quality analysis, in parts.
 *
 * This file held four separate jobs and had grown to 1.357 lines: converting
 * the canvas to an IR, the lint rules, the ten scoring dimensions, and the
 * orchestration that combines them. Reading any one of them meant scrolling
 * past the other three, and none could be exercised without the others.
 *
 * What stays here is the orchestration — the part that actually needs all
 * four. Everything the rest of the app imports is re-exported below, so the
 * split changed where the code lives and not this module's public shape:
 * thirty-seven call sites kept working untouched.
 */
import {
    clamp,
    type DiagramLintIssue,
    type DiagramPreflightCheck,
    type DiagramPreflightReport,
    type DiagramQualityReport,
    type DiagramScoreBreakdown,
} from '../quality/diagramQualityTypes';
import { mergeIRMetadata, toDiagramIR } from '../quality/canvasToIR';
import { collectIssues } from '../quality/diagramLintRules';
import {
    DIMENSION_WEIGHTS,
    applyQualityCaps,
    buildBreakdown,
    issuePenalty,
} from '../quality/diagramScoring';
import {
    archetypeSuggestionsToIssues,
    bpmnIssuesToLints,
    c4IssuesToLints,
    healthcareIssuesToLints,
    visualLintsToIssues,
} from '../quality/issueAdapters';

export { mergeIRMetadata, toDiagramIR };
export type {
    DiagramLintIssue,
    DiagramPreflightCheck,
    DiagramPreflightReport,
    DiagramQualityReport,
    DiagramScoreBreakdown,
};






export interface AnalyzeDiagramQualityOptions {
    /**
     * Phase 2 — actual node rectangles produced by the live layout (dagre
     * or ELK). When provided, the analyser runs the post-layout quality
     * checks (overlap detection, real bounding box, edge crossings…) and
     * merges them into the issue list. Omitted in the legacy code paths;
     * the function then falls back to the IR-only lints.
     */
    layoutRects?: NodeRect[];
    /**
     * Gap 1 — real group/boundary rectangles emitted by the canvas. When
     * provided alongside `layoutRects` the analyser detects boundary
     * overlap and member-containment breaches.
     */
    groupRects?: GroupRect[];
    /**
     * Gap 1 — the useful canvas viewport (in flow coordinates, with
     * toolbars/minimap excluded). Enables off-screen-node detection and
     * "more than 65% empty space" warnings before export.
     */
    viewport?: ViewportRect;
    /**
     * Gap 1 — floating panels that visually cover the canvas (toolbar,
     * inspector, minimap, legend). Each obstacle is a canvas-coordinate
     * rectangle; nodes whose rect intersects an obstacle are flagged as
     * obscured.
     */
    floatingObstacles?: FloatingObstacleRect[];
    /**
     * Gap 1 — edge waypoints from the routing engine. When omitted the
     * analyser falls back to straight source→target segments.
     */
    edgeSegments?: EdgeSegment[];
    /**
     * Gap 1 — the layout plan active when the snapshot was taken. Recorded
     * verbatim on the returned report so observability surfaces can show
     * which engine produced the metrics.
     */
    layoutPlan?: {
        backend: 'dagre' | 'elk';
        algorithm?: string;
        direction?: 'TB' | 'LR' | 'BT' | 'RL';
        density?: 'compact' | 'normal' | 'spacious';
        orthogonal?: boolean;
        rationale?: string;
        computedAt?: string;
    };
    /**
     * Gap 2 — runtime hints used by Visual Quality Gate 2.0.
     */
    recentRenderErrors?: number;
    exportPreflightOk?: boolean;
    smartFitDecision?: {
        readable: boolean;
        showExploreHint: boolean;
        showViewAllSecondary: boolean;
        reason?: 'ok' | 'zoom-too-low' | 'node-too-small' | 'label-too-small';
    };
    canvasState?: {
        visibleViewport: { minX: number; minY: number; maxX: number; maxY: number };
        contentBounds: { minX: number; minY: number; maxX: number; maxY: number };
        logicalCanvasBounds: { minX: number; minY: number; maxX: number; maxY: number };
        safeInteractionBounds: { minX: number; minY: number; maxX: number; maxY: number };
        exportBounds: { minX: number; minY: number; maxX: number; maxY: number };
    };
}

export const analyzeDiagramQuality = (
    diagram: DiagramIR,
    options: AnalyzeDiagramQualityOptions = {},
): DiagramQualityReport => {
    const baseIssues = collectIssues(diagram);

    // Archetype-specific gates layer on top of the base issues so the score
    // reflects diagram-type-aware rules (integration without protocol,
    // context with too much technical detail, …). They are also returned
    // verbatim in `suggestions` so the UI can render them with extra
    // metadata (category, justification, autoApplicable).
    const archetype = detectDiagramArchetype(diagram);
    const suggestions = buildArchetypeSuggestions(diagram, archetype);
    const archetypeIssues = archetypeSuggestionsToIssues(suggestions);
    // Visual lints live alongside the semantic ones. They cover what the
    // human eye sees (sparsity, label collisions, vertical value streams…)
    // and contribute to the same penalty budget. Computed once per
    // analysis call — pure function, no shared state.
    const visualIssues = visualLintsToIssues(collectVisualLints(diagram));
    // Phase 2: real-positions layout quality. Only runs when the caller
    // passes the live rectangles (`layoutRects`). The metrics are also
    // exposed via `analyzeLayoutQuality` for callers that just need the
    // bounding box / overlap data.
    let layoutMetrics: LayoutQualityMetrics | null = null;
    let layoutIssues: VisualLintIssue[] = [];
    if (options.layoutRects && options.layoutRects.length > 0) {
        // Gap 1: forward the full layout snapshot when the canvas supplied
        // it. The analyser is forwards-compatible: omitted fields fall back
        // to legacy behaviour (no group/viewport/obstacle checks).
        layoutMetrics = computeLayoutQuality({
            ir: diagram,
            nodeRects: options.layoutRects,
            groupRects: options.groupRects,
            viewport: options.viewport,
            floatingObstacles: options.floatingObstacles,
            edgeSegments: options.edgeSegments,
        });
        layoutIssues = layoutMetricsToLints(layoutMetrics);
    }

    // Phase 3: BPMN formal validation. Only runs when the IR is
    // explicitly or heuristically a BPMN process — non-BPMN diagrams stay
    // unaffected. The validator is pure so we can call it
    // unconditionally and discard the result when the diagram type does
    // not warrant it.
    let bpmnIssues: BpmnValidationIssue[] = [];
    try {
        const dtype = diagram.metadata?.diagramType ?? inferDiagramType({ ir: diagram });
        if (dtype === 'bpmn-process') bpmnIssues = validateBPMN(diagram);
    } catch (err) {
        console.warn('[analyzeDiagramQuality] BPMN validation threw; skipping', err);
    }

    // Phase 3: healthcare / insurance compliance rules. Always runs
    // because the validator self-filters by keyword/classification
    // signals; non-healthcare diagrams return an empty array.
    let healthcareIssues: HealthcareComplianceIssue[] = [];
    try {
        healthcareIssues = validateHealthcareCompliance(diagram);
    } catch (err) {
        console.warn('[analyzeDiagramQuality] Healthcare validation threw; skipping', err);
    }

    // Gap 9: C4 strict validation per level (context / container /
    // component / deployment). Self-filtered by `metadata.diagramType` so
    // non-C4 diagrams return an empty list.
    let c4Issues: C4ValidationIssue[] = [];
    try {
        c4Issues = validateC4(diagram);
    } catch (err) {
        console.warn('[analyzeDiagramQuality] C4 validation threw; skipping', err);
    }

    const issues = dedupeIssues([
        ...baseIssues,
        ...archetypeIssues,
        ...visualIssues,
        ...visualLintsToIssues(layoutIssues),
        ...bpmnIssuesToLints(bpmnIssues),
        ...healthcareIssuesToLints(healthcareIssues),
        ...c4IssuesToLints(c4Issues),
    ]);

    const breakdown = buildBreakdown(diagram);

    const weightedScore = Object.entries(DIMENSION_WEIGHTS).reduce((acc, [k, weight]) => {
        const key = k as keyof DiagramScoreBreakdown;
        return acc + ((breakdown[key] * weight) / 100);
    }, 0);

    const penalty = issuePenalty(issues);
    const uncappedScore = clamp(Math.round(weightedScore - penalty));
    const score = applyQualityCaps(diagram, issues, uncappedScore);

    const summary =
        score >= 90 ? 'World Class: listo para comité ejecutivo y revisión técnica.' :
        score >= 80 ? 'Profesional: sólido para compartir con stakeholders.' :
        score >= 70 ? 'Aceptable: requiere mejoras menores antes de presentar.' :
        score >= 60 ? 'Riesgoso: revisar hallazgos antes de exportar.' :
        'No exportable: requiere mejoras estructurales.';

    const visualGate = (layoutMetrics || options.recentRenderErrors || options.exportPreflightOk === false)
        ? runVisualQualityGate({
            ir: diagram,
            nodes: diagram.nodes.map((n) => ({
                id: n.id,
                position: { x: 0, y: 0 },
                data: { label: n.label },
            })),
            layoutMetrics: layoutMetrics ?? undefined,
            smartFit: options.smartFitDecision,
            canvasState: options.canvasState,
            recentRenderErrors: options.recentRenderErrors,
            exportPreflightOk: options.exportPreflightOk,
        })
        : undefined;

    return { score, breakdown, issues, summary, archetype, suggestions, layoutMetrics: layoutMetrics ?? undefined, visualGate };
};

/** De-duplicate issues by their stable id — archetype rules may overlap with
 *  base rules (eg. generic-classification appears in both). */
function dedupeIssues(issues: DiagramLintIssue[]): DiagramLintIssue[] {
    const seen = new Set<string>();
    const out: DiagramLintIssue[] = [];
    for (const issue of issues) {
        if (seen.has(issue.id)) continue;
        seen.add(issue.id);
        out.push(issue);
    }
    return out;
}

// Convenience helper for dashboards that want per-dimension weighting data.
export const DIAGRAM_DIMENSION_WEIGHTS = DIMENSION_WEIGHTS;

/**
 * Export preflight — deterministic checks before allowing PNG/SVG exports.
 * Intent: prevent users from exporting diagrams that are clearly not
 * presentation-ready (critical integrity issues, severe quality deficits).
 */
/**
 * Detect IRs that the resolver synthesised as a placeholder ("Diagrama no
 * disponible") because the upstream content was unparseable. These IRs are
 * structurally valid (≥2 nodes, ≥1 edge) and would otherwise sneak past the
 * structural / minimum-content checks, leading to embarrassing exports of the
 * fallback message itself.
 */
const isPlaceholderIR = (diagram: DiagramIR): boolean => {
    if (diagram.metadata?.degradationReason === 'no-parseable-content') return true;
    if (diagram.metadata?.title === 'Marcador de posición') return true;
    if (diagram.nodes.some(n => n.id === 'placeholder-info' || n.id === 'placeholder-action')) return true;
    return false;
};

const isSkeletonFallback = (diagram: DiagramIR): boolean => diagram.metadata?.fallback === 'skeleton';

export interface BuildPreflightOptions {
    /**
     * Gap 14 — real-position layout metrics emitted by the canvas. When
     * provided, the preflight adds checks for node overlap, group overlap,
     * boundary breaches, label collisions, export crop risk, aspect strip,
     * excessive density and excessive empty space.
     */
    layoutMetrics?: LayoutQualityMetrics;
}

export const buildDiagramPreflightReport = (
    diagram: DiagramIR,
    quality?: DiagramQualityReport,
    options: BuildPreflightOptions = {},
): DiagramPreflightReport => {
    const report = quality ?? analyzeDiagramQuality(diagram);
    const nodes = diagram.nodes.length;
    const edges = diagram.edges.length;
    const critical = report.issues.filter(i => i.severity === 'critical').length;
    const high = report.issues.filter(i => i.severity === 'high').length;
    const missingEdgeLabels = report.issues.filter(i => i.code === 'EDGE_MISSING_LABEL').length;
    const layoutMetrics = options.layoutMetrics ?? report.layoutMetrics;

    const orphanCount = report.issues.filter(i => i.code === 'ORPHAN_NODE').length;
    const invalidEdgeCount = report.issues.filter(i => i.code === 'EDGE_INVALID_REFERENCE').length;

    const placeholder = isPlaceholderIR(diagram);
    const skeleton = isSkeletonFallback(diagram);
    const hasDegradationReason = !placeholder && typeof diagram.metadata?.degradationReason === 'string'
        && diagram.metadata.degradationReason.trim().length > 0;

    const generationState: DiagramPreflightCheck = placeholder
        ? {
            id: 'generation-state',
            label: 'Estado de generación',
            status: 'fail',
            detail: 'Marcador de posición: la IA no devolvió contenido parseable. Pulsa "Generar de Nuevo" antes de exportar.',
        }
        : skeleton
            ? {
                id: 'generation-state',
                label: 'Estado de generación',
                status: 'fail',
                detail: 'Esqueleto base local: el modelo agotó los reintentos. Edita los nodos o regenera con más contexto antes de exportar.',
            }
            : hasDegradationReason
                ? {
                    id: 'generation-state',
                    label: 'Estado de generación',
                    status: 'warn',
                    detail: `El artefacto se marcó como degradado: ${diagram.metadata?.degradationReason}. Revisa antes de exportar.`,
                }
                : {
                    id: 'generation-state',
                    label: 'Estado de generación',
                    status: 'pass',
                    detail: 'Generación nominal: sin marcadores de degradación.',
                };

    const checks: DiagramPreflightCheck[] = [
        generationState,
        {
            id: 'integrity',
            label: 'Integridad estructural',
            status: critical > 0 || invalidEdgeCount > 0 ? 'fail' : 'pass',
            detail: critical > 0 || invalidEdgeCount > 0
                ? `Se detectaron ${critical} hallazgos críticos (incl. ${invalidEdgeCount} referencia(s) inválidas).`
                : 'No se detectaron hallazgos críticos.',
        },
        {
            id: 'orphans',
            label: 'Nodos conectados al flujo',
            status: orphanCount > 0 ? 'fail' : 'pass',
            detail: orphanCount > 0
                ? `${orphanCount} nodo(s) huérfano(s). Reconecta o elimina antes de exportar.`
                : 'Todos los nodos están conectados al flujo principal.',
        },
        {
            id: 'minimum-content',
            label: 'Contenido mínimo',
            status: nodes < 2 || edges < 1 ? 'fail' : 'pass',
            detail: nodes < 2 || edges < 1
                ? `El diagrama tiene ${nodes} nodos y ${edges} aristas. Se requiere al menos 2 nodos y 1 arista para exportación formal.`
                : `Cobertura suficiente: ${nodes} nodos, ${edges} aristas.`,
        },
        {
            id: 'quality-score',
            label: 'Puntaje de calidad',
            // Tightened bands: <70 fail, 70–89 warn (recommend auto-improve), ≥90 pass.
            status: report.score < 70 ? 'fail' : report.score < 90 ? 'warn' : 'pass',
            detail: report.score < 70
                ? `Score ${report.score}/100: por debajo del umbral mínimo (70) para exportación.`
                : report.score < 90
                    ? `Score ${report.score}/100: exportable, pero recomendamos ejecutar Auto-mejorar para alcanzar World Class (≥ 90).`
                    : `Score ${report.score}/100: World Class — apto para presentación ejecutiva.`,
        },
        {
            id: 'edge-narrative',
            label: 'Narrativa de relaciones',
            status: missingEdgeLabels > 0 ? (missingEdgeLabels > Math.max(2, Math.floor(edges * 0.4)) ? 'fail' : 'warn') : 'pass',
            detail: missingEdgeLabels > 0
                ? `${missingEdgeLabels} aristas sin etiqueta narrativa/protocolo.`
                : 'Todas las aristas tienen etiqueta.',
        },
        {
            id: 'high-severity',
            label: 'Riesgos de severidad alta',
            status: high > 4 ? 'fail' : high > 0 ? 'warn' : 'pass',
            detail: high > 0
                ? `${high} hallazgos de severidad alta pendientes.`
                : 'Sin hallazgos de severidad alta.',
        },
    ];

    // Gap 14: layout-aware preflight checks. Only added when the canvas
    // emitted a real-position snapshot; non-diagram artefacts skip them.
    if (layoutMetrics?.hasLayout) {
        const overlapCount = layoutMetrics.overlappingNodePairs.length;
        const groupOverlapCount = layoutMetrics.overlappingGroupPairs.length;
        const breachCount = layoutMetrics.boundaryContainmentBreaches.reduce((acc, b) => acc + b.nodeIds.length, 0);
        const labelCollisions = layoutMetrics.edgeLabelCollisions.length;
        const offscreenCount = layoutMetrics.nodesOutsideViewport.length;
        const obscuredCount = layoutMetrics.nodesObscuredByObstacles.length;
        const cropRisk = layoutMetrics.exportClipRisk || layoutMetrics.exportCropRisk === 'high';
        const aspectStrip = layoutMetrics.aspectStrip !== null;
        const tooDense = layoutMetrics.density >= 0.5;
        const tooEmpty = layoutMetrics.excessiveEmptySpace;

        checks.push(
            {
                id: 'layout-overlap',
                label: 'Solape de nodos en el layout',
                status: overlapCount > 0 ? 'fail' : 'pass',
                detail: overlapCount > 0
                    ? `${overlapCount} par(es) de nodos se superponen visualmente; aplica un layout más espacioso.`
                    : 'No se detectaron nodos superpuestos.',
            },
            {
                id: 'layout-group-overlap',
                label: 'Solape de boundaries / grupos',
                status: groupOverlapCount > 0 ? 'fail' : 'pass',
                detail: groupOverlapCount > 0
                    ? `${groupOverlapCount} par(es) de boundaries se traslapan; separa los grupos antes de exportar.`
                    : 'Boundaries sin traslape.',
            },
            {
                id: 'layout-boundary-breach',
                label: 'Contención de boundaries',
                status: breachCount > 0 ? 'fail' : 'pass',
                detail: breachCount > 0
                    ? `${breachCount} nodo(s) escapan del boundary de su grupo. Reaplica ELK layered o ajusta posiciones manualmente.`
                    : 'Todos los nodos quedan dentro de su boundary.',
            },
            {
                id: 'layout-edge-crossings',
                label: 'Cruces de aristas',
                status: layoutMetrics.edgeCrossings >= Math.max(8, Math.ceil(layoutMetrics.nodeCount * 1.2))
                    ? 'fail'
                    : layoutMetrics.edgeCrossings >= Math.max(4, Math.ceil(layoutMetrics.nodeCount * 0.6))
                        ? 'warn'
                        : 'pass',
                detail: `${layoutMetrics.edgeCrossings} cruces detectados sobre las posiciones reales.`,
            },
            {
                id: 'layout-edge-label-collisions',
                label: 'Colisiones de etiquetas',
                status: labelCollisions >= 6 ? 'fail' : labelCollisions > 0 ? 'warn' : 'pass',
                detail: labelCollisions > 0
                    ? `${labelCollisions} etiquetas de aristas se traslapan; aumenta el espaciado o acorta labels.`
                    : 'Sin colisiones de etiquetas.',
            },
            {
                id: 'layout-export-crop-risk',
                label: 'Riesgo de recorte en exportación',
                status: cropRisk ? 'fail' : layoutMetrics.exportCropRisk === 'medium' ? 'warn' : 'pass',
                detail: cropRisk
                    ? 'Contenido contra el borde del bounding box: la exportación recortará labels, badges o boundaries.'
                    : layoutMetrics.exportCropRisk === 'medium'
                        ? 'Riesgo medio de recorte; añade padding antes de exportar.'
                        : 'Sin riesgo de recorte detectado.',
            },
            {
                id: 'layout-aspect-strip',
                label: 'Proporción del layout',
                status: aspectStrip ? 'warn' : 'pass',
                detail: aspectStrip
                    ? `Layout en tira ${layoutMetrics.aspectStrip} (ratio ${layoutMetrics.aspectRatio.toFixed(1)}:1); considera cambiar dirección o usar lanes.`
                    : 'Proporción equilibrada.',
            },
            {
                id: 'layout-density',
                label: 'Densidad del layout',
                status: tooDense ? 'fail' : layoutMetrics.density >= 0.35 ? 'warn' : 'pass',
                detail: tooDense
                    ? `Densidad ${(layoutMetrics.density * 100).toFixed(0)}%: layout muy comprimido, aplica densidad spacious o reduce nodos.`
                    : `Densidad ${(layoutMetrics.density * 100).toFixed(0)}%.`,
            },
            {
                id: 'layout-empty-space',
                label: 'Aprovechamiento del viewport',
                status: tooEmpty ? 'warn' : 'pass',
                detail: tooEmpty
                    ? 'Más del 65% del viewport está vacío; usa el bounding-box export para recortar el área útil.'
                    : 'Aprovechamiento adecuado del área visible.',
            },
            {
                id: 'layout-offscreen-nodes',
                label: 'Nodos dentro del viewport',
                status: offscreenCount > 0 ? 'warn' : 'pass',
                detail: offscreenCount > 0
                    ? `${offscreenCount} nodo(s) quedaron fuera del viewport útil.`
                    : 'Todos los nodos visibles.',
            },
            {
                id: 'layout-obscured-by-panels',
                label: 'Visibilidad libre de paneles',
                status: obscuredCount > 0 ? 'warn' : 'pass',
                detail: obscuredCount > 0
                    ? `${obscuredCount} nodo(s) tapados por paneles flotantes; cierra el inspector o recoloca toolbars.`
                    : 'Sin nodos ocultos por paneles.',
            },
        );
    }

    // Gap 6 — healthcare / insurance hard gates. Diagrams that touch PHI /
    // PII / claims must declare classification + security + observability
    // before they can be exported as a formal artefact. The findings are
    // already in `report.issues` (from validateHealthcareCompliance) — we
    // promote a subset to preflight `fail` checks so the export modal
    // actually blocks the formal export instead of just adding a warning.
    if (isHealthcareContext(diagram)) {
        const phiUntagged = report.issues.some(i => i.code === 'HC_MISSING_PHI_CLASSIFICATION');
        const sensitiveEdgesMissingSecurity = report.issues.some(i => i.code === 'HC_SENSITIVE_EDGE_MISSING_SECURITY');
        const missingObservability = report.issues.some(i => i.code === 'HC_MISSING_OBSERVABILITY');
        const missingAdjudicationTrace = report.issues.some(i => i.code === 'HC_MISSING_ADJUDICATION_TRACE');

        checks.push(
            {
                id: 'healthcare-phi-classification',
                label: 'Clasificación PHI/PII',
                status: phiUntagged ? 'fail' : 'pass',
                detail: phiUntagged
                    ? 'Hay nodos con datos clínicos / de afiliados sin clasificar (dataClassification PHI / PII / PCI). Etiqueta antes de exportar como artefacto formal.'
                    : 'Datos sensibles correctamente clasificados.',
            },
            {
                id: 'healthcare-edge-security',
                label: 'Seguridad en relaciones sensibles',
                status: sensitiveEdgesMissingSecurity ? 'fail' : 'pass',
                detail: sensitiveEdgesMissingSecurity
                    ? 'Hay aristas que mueven PHI/PII sin declarar OAuth2 / JWT / mTLS / API Gateway. Documenta el control antes de exportar.'
                    : 'Aristas sensibles documentan su mecanismo de seguridad.',
            },
            {
                id: 'healthcare-observability',
                label: 'Observabilidad de flujos críticos',
                status: missingObservability ? 'fail' : 'pass',
                detail: missingObservability
                    ? 'Flujos críticos no declaran observabilidad (logs / metrics / traces / DLQ / alertas). HIPAA y SOC2 exigen pista de auditoría.'
                    : 'Flujos críticos declaran observabilidad / auditoría.',
            },
            {
                id: 'healthcare-adjudication-trace',
                label: 'Trazabilidad de claims',
                status: missingAdjudicationTrace ? 'warn' : 'pass',
                detail: missingAdjudicationTrace
                    ? 'El flujo de claims no expone adjudicación / accumulator / remittance / pago. Recomendado para auditoría regulatoria.'
                    : 'Trazabilidad end-to-end de claims completa.',
            },
        );
    }

    const ready = !checks.some(c => c.status === 'fail');
    return { ready, checks };
};

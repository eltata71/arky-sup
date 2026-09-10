/**
 * Consolidated diagram diagnostic summary.
 *
 * Gap 5 — un arquitecto debe poder entender por qué un diagrama no es
 * "world-class" y qué acción aplicar para corregirlo. Antes había varias
 * superficies dispersas (trace técnico, panel de calidad, preflight,
 * inspector); esta función agrega TODO el contexto necesario en un
 * único payload estructurado que la UI puede renderizar (o el reporte
 * técnico copiable puede incluir).
 *
 * El builder es puro / sincrónico y no toca el DOM — todos los
 * componentes que lo consumen son responsables de su propio render.
 */

import type { DiagramIR } from '../../lib/diagram';
import type { DiagramQualityReport, DiagramPreflightReport } from './quality/diagramQualityService';
import type { LayoutQualityMetrics } from './layoutQualityService';
import type { ArtifactSuggestionActionKind } from '../../lib/artifacts/artifactSuggestions';

export type DiagnosticSourceKind = 'ir-direct' | 'mermaid' | 'react-flow-json' | 'fallback' | 'skeleton' | 'placeholder' | 'unknown';

export interface DiagnosticLayoutPlanSummary {
    backend: 'dagre' | 'elk' | 'unknown';
    algorithm: string | null;
    direction: 'TB' | 'LR' | 'BT' | 'RL' | null;
    density: 'compact' | 'normal' | 'spacious' | null;
    orthogonal: boolean;
    rationale: string | null;
    computedAt: string | null;
    userOverride: boolean;
}

export interface DiagnosticVisualMetricsSummary {
    hasLayout: boolean;
    nodeCount: number;
    edgeCount: number;
    groupCount: number;
    boundingBox: { x: number; y: number; width: number; height: number };
    density: number;
    aspectRatio: number;
    overlaps: number;
    groupOverlaps: number;
    boundaryBreaches: number;
    edgeCrossings: number;
    labelCollisions: number;
    offscreenNodes: number;
    obscuredByPanels: number;
    edgesThroughNodes: number;
    exportCropRisk: 'none' | 'low' | 'medium' | 'high';
    exportClipRisk: boolean;
    excessiveEmptySpace: boolean;
}

export interface DiagnosticValidationFamilySummary {
    family: 'c4' | 'bpmn' | 'integration' | 'healthcare-insurance' | 'accessibility' | 'exportability' | 'visual-layout' | 'governance';
    label: string;
    total: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
    sampleIds: string[];
}

export interface DiagnosticRecommendedAction {
    kind: ArtifactSuggestionActionKind;
    label: string;
    reason: string;
}

export interface DiagramDiagnosticSummary {
    /** Where the renderable diagram came from. */
    source: DiagnosticSourceKind;
    /** Layout plan applied to the current render (when known). */
    layout: DiagnosticLayoutPlanSummary;
    /** Visual / layout-aware metrics (zeroed when no positions are available). */
    metrics: DiagnosticVisualMetricsSummary;
    /** Issue counts grouped by validation family. */
    validations: DiagnosticValidationFamilySummary[];
    /** Concrete actions the user should run, ordered by priority. */
    recommendedActions: DiagnosticRecommendedAction[];
    /** True when the diagram is considered ready for formal export. */
    ready: boolean;
    /** Short, one-line summary suitable for a toast / banner. */
    headline: string;
}

export interface BuildDiagramDiagnosticSummaryInput {
    ir: DiagramIR | null;
    quality?: DiagramQualityReport | null;
    preflight?: DiagramPreflightReport | null;
    /** Source of the renderable diagram (resolveRenderableDiagram.source). */
    source?: DiagnosticSourceKind | string | null;
}

const EMPTY_METRICS: DiagnosticVisualMetricsSummary = {
    hasLayout: false,
    nodeCount: 0,
    edgeCount: 0,
    groupCount: 0,
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
    density: 0,
    aspectRatio: 1,
    overlaps: 0,
    groupOverlaps: 0,
    boundaryBreaches: 0,
    edgeCrossings: 0,
    labelCollisions: 0,
    offscreenNodes: 0,
    obscuredByPanels: 0,
    edgesThroughNodes: 0,
    exportCropRisk: 'none',
    exportClipRisk: false,
    excessiveEmptySpace: false,
};

const EMPTY_LAYOUT: DiagnosticLayoutPlanSummary = {
    backend: 'unknown',
    algorithm: null,
    direction: null,
    density: null,
    orthogonal: false,
    rationale: null,
    computedAt: null,
    userOverride: false,
};

function normaliseSource(input: string | null | undefined): DiagnosticSourceKind {
    if (!input) return 'unknown';
    const v = input.toLowerCase();
    if (v.includes('ir-direct') || v.includes('ir_direct') || v === 'ir') return 'ir-direct';
    if (v.includes('mermaid')) return 'mermaid';
    if (v.includes('react-flow') || v.includes('reactflow')) return 'react-flow-json';
    if (v.includes('skeleton')) return 'skeleton';
    if (v.includes('placeholder')) return 'placeholder';
    if (v.includes('fallback')) return 'fallback';
    return 'unknown';
}

function buildLayoutSummary(ir: DiagramIR | null): DiagnosticLayoutPlanSummary {
    const plan = ir?.metadata?.layoutPlan;
    if (!plan) return EMPTY_LAYOUT;
    return {
        backend: (plan.backend ?? 'unknown') as DiagnosticLayoutPlanSummary['backend'],
        algorithm: plan.algorithm ?? null,
        direction: (plan.direction ?? null) as DiagnosticLayoutPlanSummary['direction'],
        density: (plan.density ?? null) as DiagnosticLayoutPlanSummary['density'],
        orthogonal: Boolean(plan.orthogonal),
        rationale: plan.rationale ?? null,
        computedAt: plan.computedAt ?? null,
        userOverride: Boolean(plan.userOverride),
    };
}

function buildMetricsSummary(ir: DiagramIR | null, metrics: LayoutQualityMetrics | null | undefined): DiagnosticVisualMetricsSummary {
    if (!ir) return EMPTY_METRICS;
    const groupCount = ir.groups?.length ?? 0;
    const edgeCount = ir.edges?.length ?? 0;
    if (!metrics?.hasLayout) {
        return {
            ...EMPTY_METRICS,
            nodeCount: ir.nodes?.length ?? 0,
            edgeCount,
            groupCount,
        };
    }
    return {
        hasLayout: true,
        nodeCount: metrics.nodeCount,
        edgeCount,
        groupCount,
        boundingBox: metrics.boundingBox,
        density: metrics.density,
        aspectRatio: metrics.aspectRatio,
        overlaps: metrics.overlappingNodePairs.length,
        groupOverlaps: metrics.overlappingGroupPairs.length,
        boundaryBreaches: metrics.boundaryContainmentBreaches.reduce((acc, b) => acc + b.nodeIds.length, 0),
        edgeCrossings: metrics.edgeCrossings,
        labelCollisions: metrics.edgeLabelCollisions.length,
        offscreenNodes: metrics.nodesOutsideViewport.length,
        obscuredByPanels: metrics.nodesObscuredByObstacles.length,
        edgesThroughNodes: metrics.edgesCrossingNodes.length,
        exportCropRisk: metrics.exportCropRisk,
        exportClipRisk: metrics.exportClipRisk,
        excessiveEmptySpace: metrics.excessiveEmptySpace,
    };
}

function classifyIssueFamily(code: string): DiagnosticValidationFamilySummary['family'] {
    if (code.startsWith('C4_') || code.startsWith('c4-')) return 'c4';
    if (code.startsWith('BPMN_')) return 'bpmn';
    if (code.startsWith('HC_')) return 'healthcare-insurance';
    if (code.startsWith('VISUAL_') || code === 'GAP_LAYOUT' || code.includes('LAYOUT')) return 'visual-layout';
    if (code.startsWith('A11Y_') || code.startsWith('ACCESSIBILITY')) return 'accessibility';
    if (code === 'EDGE_MISSING_PROTOCOL' || code === 'EDGE_MISSING_LABEL' || code === 'EDGE_INVALID_REFERENCE' || code.startsWith('INTEGRATION_')) return 'integration';
    if (code.startsWith('EXPORT_')) return 'exportability';
    return 'governance';
}

const FAMILY_LABELS: Record<DiagnosticValidationFamilySummary['family'], string> = {
    'c4': 'C4 / niveles arquitectónicos',
    'bpmn': 'BPMN 2.0',
    'integration': 'Integración / protocolos',
    'healthcare-insurance': 'Salud / seguros (HIPAA, FHIR, X12, NCPDP)',
    'accessibility': 'Accesibilidad',
    'exportability': 'Exportabilidad / preflight',
    'visual-layout': 'Layout visual',
    'governance': 'Gobernanza / metadata',
};

function buildValidationSummaries(quality: DiagramQualityReport | null | undefined): DiagnosticValidationFamilySummary[] {
    if (!quality || !quality.issues) return [];
    const buckets = new Map<DiagnosticValidationFamilySummary['family'], DiagnosticValidationFamilySummary>();
    for (const issue of quality.issues) {
        const family = classifyIssueFamily(issue.code);
        const bucket = buckets.get(family) ?? {
            family,
            label: FAMILY_LABELS[family],
            total: 0,
            bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
            sampleIds: [],
        };
        bucket.total += 1;
        if (issue.severity === 'critical' || issue.severity === 'high' || issue.severity === 'medium' || issue.severity === 'low') {
            bucket.bySeverity[issue.severity] += 1;
        }
        if (bucket.sampleIds.length < 3) bucket.sampleIds.push(issue.id);
        buckets.set(family, bucket);
    }
    return Array.from(buckets.values()).sort((a, b) => b.total - a.total);
}

function buildRecommendedActions(
    metrics: DiagnosticVisualMetricsSummary,
    layout: DiagnosticLayoutPlanSummary,
    validations: DiagnosticValidationFamilySummary[],
    preflight: DiagramPreflightReport | null | undefined,
    ir: DiagramIR | null,
): DiagnosticRecommendedAction[] {
    const out: DiagnosticRecommendedAction[] = [];
    const seen = new Set<ArtifactSuggestionActionKind>();
    const push = (action: DiagnosticRecommendedAction) => {
        if (seen.has(action.kind)) return;
        seen.add(action.kind);
        out.push(action);
    };

    // Layout fixes — highest priority because they unlock everything else.
    if (metrics.overlaps > 0 || metrics.groupOverlaps > 0 || metrics.boundaryBreaches > 0 || metrics.exportClipRisk || metrics.edgesThroughNodes > 0) {
        push({
            kind: 'apply-elk-layout',
            label: 'Aplicar ELK layered + ortogonal',
            reason: 'Solapes, breach de boundaries o edges atravesando nodos: necesitas un re-layout limpio.',
        });
    }
    if (metrics.excessiveEmptySpace || metrics.exportCropRisk === 'high') {
        push({
            kind: 'set-layout-density',
            label: 'Cambiar densidad a compact',
            reason: 'Demasiado espacio vacío o riesgo de recorte: una densidad compact aprovecha el viewport.',
        });
    }
    if (layout.direction === 'TB' && (metrics.nodeCount > 10 || metrics.aspectRatio > 2.5)) {
        push({
            kind: 'set-layout-direction',
            label: 'Cambiar a LR (lectura horizontal)',
            reason: 'Diagrama vertical extenso: la lectura LR encaja mejor en pantallas modernas.',
        });
    }

    // Domain validations.
    const hc = validations.find((v) => v.family === 'healthcare-insurance');
    if (hc && hc.total > 0) {
        push({
            kind: 'tag-phi-pii',
            label: 'Etiquetar PHI / PII / PCI',
            reason: `${hc.total} hallazgos del validador salud/seguros; clasifica datos sensibles antes de exportar.`,
        });
        push({
            kind: 'add-security-controls',
            label: 'Documentar OAuth2 / mTLS / JWT',
            reason: 'Los flujos sensibles deben declarar su mecanismo de seguridad.',
        });
    }

    const bpmn = validations.find((v) => v.family === 'bpmn');
    if (bpmn && bpmn.total > 0) {
        push({
            kind: 'convert-to-bpmn',
            label: 'Reforzar contrato BPMN',
            reason: `${bpmn.total} hallazgos BPMN; start/end, gateways y carriles deben estar explícitos.`,
        });
    }

    const c4 = validations.find((v) => v.family === 'c4');
    if (c4 && c4.total > 0) {
        push({
            kind: 'split-c4-levels',
            label: 'Separar niveles C4',
            reason: 'El validador detectó mezcla de niveles; sepáralos para mantener foco por audiencia.',
        });
    }

    const integration = validations.find((v) => v.family === 'integration');
    if (integration && integration.total > 0) {
        push({
            kind: 'add-missing-protocols',
            label: 'Asignar protocolo en relaciones críticas',
            reason: 'Hay relaciones críticas sin protocolo o sin narrativa.',
        });
    }

    // Group classification.
    if (ir && ir.groups.some((g) => !g.kind)) {
        push({
            kind: 'assign-group-kind',
            label: 'Clasificar boundaries / grupos',
            reason: 'Grupos sin tipo: el renderer no puede pintar el boundary correcto.',
        });
    }

    // Final fallback: if preflight blocks export, offer exportability repair.
    if (preflight && !preflight.ready) {
        push({
            kind: 'repair-exportability',
            label: 'Reparar exportabilidad',
            reason: 'El preflight bloquea la exportación; ejecuta la auto-mejora hasta pasar los gates.',
        });
    }

    return out;
}

function buildHeadline(metrics: DiagnosticVisualMetricsSummary, validations: DiagnosticValidationFamilySummary[], preflight: DiagramPreflightReport | null | undefined): string {
    if (!preflight) return 'Diagnóstico no disponible: el diagrama aún no se ha renderizado.';
    if (preflight.ready && validations.every((v) => v.bySeverity.critical === 0 && v.bySeverity.high === 0)) {
        return 'Diagrama listo para exportación formal: sin hallazgos críticos.';
    }
    if (!preflight.ready) {
        const failing = preflight.checks.find((c) => c.status === 'fail');
        return failing
            ? `Exportación bloqueada: ${failing.label.toLowerCase()} — ${failing.detail}`
            : 'Exportación bloqueada: revisa los checks de preflight.';
    }
    if (metrics.overlaps > 0 || metrics.boundaryBreaches > 0) {
        return 'Layout con superposiciones o boundaries inválidos: aplica re-layout antes de exportar.';
    }
    return 'Diagrama exportable con observaciones; revisa las acciones recomendadas para alcanzar World Class.';
}

export function buildDiagramDiagnosticSummary(input: BuildDiagramDiagnosticSummaryInput): DiagramDiagnosticSummary {
    const { ir, quality, preflight, source } = input;
    const layout = buildLayoutSummary(ir);
    const metrics = buildMetricsSummary(ir, quality?.layoutMetrics);
    const validations = buildValidationSummaries(quality);
    const recommendedActions = buildRecommendedActions(metrics, layout, validations, preflight, ir);
    const ready = preflight ? preflight.ready : false;
    const headline = buildHeadline(metrics, validations, preflight);
    return {
        source: normaliseSource(source ?? ir?.metadata?.sourceFormat ?? null),
        layout,
        metrics,
        validations,
        recommendedActions,
        ready,
        headline,
    };
}

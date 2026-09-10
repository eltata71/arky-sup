/**
 * The ten scoring dimensions, their weights, and the caps.
 *
 * Each dimension answers one question about the diagram and returns 0–100.
 * They are deliberately independent: a diagram can be legible and still be
 * useless to an executive, and a single blended number would hide that.
 *
 * The caps matter as much as the scores. Without them a diagram with a
 * critical structural defect could still average into the eighties, because
 * nine healthy dimensions outvote one broken one — and a rubric that rates a
 * broken diagram highly is worse than no rubric.
 */

import type { DiagramIR } from '../../../lib/diagram';
import type { DiagramLintIssue, DiagramScoreBreakdown } from './diagramQualityTypes';
import { clamp, hasText } from './diagramQualityTypes';
import { detectSemanticRole } from '../../../lib/diagramTokens';
// Shared with the lint rules: a dimension that rewards protocol hints and a
// rule that flags their absence must agree on what counts as one, or the score
// and the issue list contradict each other in the same report.
import { edgeHasProtocolHint, isActionableEdgeLabel, nodeHasTechBadge } from './diagramLintRules';

/**
 * How much of a story the diagram actually carries, 0–1.
 *
 * `metadata.narrative` being non-empty used to be worth a flat ten points in
 * *narrativa* and fifteen in *preparación ejecutiva* — and the repair pass
 * fills that field on every diagram it touches, so the rubric was paying for
 * its own repair. Graduated credit is the fix: a written story with scenes and
 * callouts is worth full marks, a written summary most of them, and a topology
 * description the repair composed a little, because it is shown to the reader
 * and is still not an argument about the architecture.
 */
function narrativeDepth(ir: DiagramIR): number {
    const narrative = ir.metadata?.narrative;
    if (!narrative) return 0;
    if (typeof narrative === 'string') return narrative.trim().length > 0 ? 0.3 : 0;
    if (narrative.source === 'derived') return (narrative.summary ?? '').trim().length > 0 ? 0.3 : 0;
    const hasGuidedWalk = (narrative.scenes ?? []).length > 0 || (narrative.callouts ?? []).length > 0;
    if (hasGuidedWalk) return 1;
    return (narrative.summary ?? '').trim().length > 0 ? 0.65 : 0;
}

export function scoreClaridadSemantica(ir: DiagramIR): number {
    if (ir.nodes.length === 0) return 0;
    const meaningful = ir.nodes.filter(n => {
        const kind = (n.kind ?? '').toLowerCase();
        return kind.length > 0 && kind !== 'unknown' && kind !== 'component';
    }).length;
    const kindRatio = meaningful / ir.nodes.length;
    const roleDiverse = new Set(ir.nodes.map(n => detectSemanticRole(n.label ?? '', n.kind))).size;
    const diversityBoost = Math.min(20, roleDiverse * 4);
    return clamp(Math.round(50 + kindRatio * 40 + diversityBoost - 10));
}

export function scoreConsistenciaArquitectonica(ir: DiagramIR): number {
    const src = (ir.metadata?.sourceFormat ?? 'mermaid').toString();
    const kinds = new Set(ir.nodes.map(n => (n.kind ?? '').toLowerCase()));
    const headerKind = ir.metadata?.title ? 2 : 0;

    // C4 hint: if ANY node uses C4 kinds, all non-trivial nodes should declare a kind.
    const c4Kinds = ['person', 'softwaresystem', 'container', 'component', 'deployment_node'];
    const isC4 = ir.nodes.some(n => c4Kinds.includes((n.kind ?? '').toLowerCase()));
    const c4Coverage = isC4
        ? ir.nodes.filter(n => c4Kinds.includes((n.kind ?? '').toLowerCase())).length / ir.nodes.length
        : 1;

    // Penalise when kinds are all "unknown".
    const onlyUnknown = kinds.size === 1 && (kinds.has('unknown') || kinds.has(''));
    if (onlyUnknown) return 40;

    return clamp(Math.round(60 + c4Coverage * 30 + headerKind + (src === 'mermaid' ? 5 : 0)));
}

export function scoreJerarquiaVisual(ir: DiagramIR): number {
    const n = ir.nodes.length || 1;
    const groupCount = ir.groups.length;
    const idealGroups = Math.max(1, Math.ceil(n / 6));
    // Hits max when groupCount ≈ idealGroups.
    const groupScore = 100 - Math.min(60, Math.abs(groupCount - idealGroups) * 18);
    // Penalise super-dense groups (≥ 10 nodes in one group).
    const densePenalty = ir.groups.some(g => g.nodeIds.length >= 10) ? 15 : 0;
    // Bonus when node count is in the sweet spot (4–18).
    const densityBonus = n >= 4 && n <= 18 ? 8 : 0;
    return clamp(Math.round(groupScore - densePenalty + densityBonus));
}

export function scoreLegibilidad(ir: DiagramIR): number {
    if (ir.nodes.length === 0) return 0;
    const labelLengths = ir.nodes.map(n => (n.label ?? '').length);
    const avgLen = labelLengths.reduce((a, b) => a + b, 0) / labelLengths.length;
    const shortRatio = labelLengths.filter(len => len > 0 && len <= 24).length / ir.nodes.length;
    const describedRatio = ir.nodes.filter(n => hasText(n.description)).length / ir.nodes.length;
    // Penalise very long averages.
    const avgPenalty = avgLen > 28 ? (avgLen - 28) * 1.5 : 0;
    return clamp(Math.round(40 + shortRatio * 40 + describedRatio * 30 - avgPenalty));
}

export function scoreNarrativa(ir: DiagramIR): number {
    if (ir.edges.length === 0) return ir.nodes.length <= 1 ? 80 : 30;
    const labeledRatio = ir.edges.filter(e => hasText(e.label)).length / ir.edges.length;
    const actionableRatio = ir.edges.filter(e => isActionableEdgeLabel(e.label)).length / ir.edges.length;
    const narrativePresent = Math.round(narrativeDepth(ir) * 12);
    // Bonus if an audience is declared (implies curated narrative).
    const audienceBonus = ir.metadata?.audience ? 5 : 0;
    return clamp(Math.round(30 + labeledRatio * 30 + actionableRatio * 30 + narrativePresent + audienceBonus));
}

export function scoreAtractivoVisual(ir: DiagramIR): number {
    const themed = ir.metadata?.theme ? 12 : 0;
    const densityBonus = ir.metadata?.density ? 4 : 0;
    const groupBonus = ir.groups.length > 0 ? 10 : 0;
    // Implicit palette variety derived from semantic roles actually present.
    const roleDiversity = new Set(ir.nodes.map(n => detectSemanticRole(n.label ?? '', n.kind))).size;
    const roleBonus = Math.min(20, roleDiversity * 3);
    return clamp(Math.round(55 + themed + densityBonus + groupBonus + roleBonus));
}

export function scorePreparacionEjecutiva(ir: DiagramIR): number {
    const n = ir.nodes.length;
    // Sweet spot for executive audiences: 4–10 nodes.
    const nodeScore = n === 0 ? 20
        : n <= 10 ? 40
        : n <= 14 ? 30
        : n <= 20 ? 15
        : 0;
    const labeledRatio = ir.edges.length > 0
        ? ir.edges.filter(e => hasText(e.label)).length / ir.edges.length
        : 1;
    const audienceBoost = ir.metadata?.audience === 'executive' ? 10 : 0;
    const narrativeBoost = Math.round(narrativeDepth(ir) * 15);
    const titleBoost = ir.metadata?.title ? 5 : 0;
    return clamp(Math.round(25 + nodeScore + labeledRatio * 15 + audienceBoost + narrativeBoost + titleBoost));
}

export function scorePreparacionTecnica(ir: DiagramIR): number {
    if (ir.nodes.length === 0) return 0;
    const describedRatio = ir.nodes.filter(n => hasText(n.description)).length / ir.nodes.length;
    const techBadgeRatio = ir.nodes.filter(nodeHasTechBadge).length / ir.nodes.length;
    const protocolRatio = ir.edges.length > 0
        ? ir.edges.filter(edgeHasProtocolHint).length / ir.edges.length
        : 0.5;
    return clamp(Math.round(30 + describedRatio * 35 + techBadgeRatio * 20 + protocolRatio * 20));
}

export function scoreExportabilidad(ir: DiagramIR): number {
    let score = 85;
    const hugeGroup = ir.groups.some(g => g.nodeIds.length > 12);
    if (hugeGroup) score -= 15;
    // Penalise excessive node count (won't fit on A3 horizontal at 1×).
    if (ir.nodes.length > 40) score -= 20;
    else if (ir.nodes.length > 25) score -= 10;
    if (ir.nodes.some(n => !hasText(n.label))) score -= 10;
    // Bonus when sourceFormat is known.
    if (ir.metadata?.sourceFormat) score += 5;
    return clamp(Math.round(score));
}

export function scoreMantenibilidadPipeline(ir: DiagramIR): number {
    let score = 70;
    if (ir.nodes.length === 0) return 20;
    // Deterministic ids: avoid raw UUID/timestamps.
    const looksTimestamped = ir.nodes.filter(n => /^\d{10,}$/.test(n.id)).length;
    if (looksTimestamped > 0) score -= Math.min(20, looksTimestamped * 5);
    // Reward short/meaningful ids (≤ 24 chars, alphanum-ish).
    const cleanIds = ir.nodes.filter(n => /^[A-Za-z][\w.-]{0,23}$/.test(n.id)).length;
    score += Math.round((cleanIds / ir.nodes.length) * 20);
    // Persisted IR metadata implies the canonical pipeline ran.
    if (ir.metadata?.generatedAt) score += 5;
    if (ir.metadata?.title) score += 3;
    return clamp(Math.round(score));
}

export const DIMENSION_WEIGHTS: Record<keyof DiagramScoreBreakdown, number> = {
    claridadSemantica: 15,
    consistenciaArquitectonica: 12,
    jerarquiaVisual: 10,
    legibilidad: 10,
    narrativa: 12,
    atractivoVisual: 8,
    preparacionEjecutiva: 10,
    preparacionTecnica: 10,
    exportabilidad: 6,
    mantenibilidadPipeline: 7,
};

export function buildBreakdown(ir: DiagramIR): DiagramScoreBreakdown {
    return {
        claridadSemantica: scoreClaridadSemantica(ir),
        consistenciaArquitectonica: scoreConsistenciaArquitectonica(ir),
        jerarquiaVisual: scoreJerarquiaVisual(ir),
        legibilidad: scoreLegibilidad(ir),
        narrativa: scoreNarrativa(ir),
        atractivoVisual: scoreAtractivoVisual(ir),
        preparacionEjecutiva: scorePreparacionEjecutiva(ir),
        preparacionTecnica: scorePreparacionTecnica(ir),
        exportabilidad: scoreExportabilidad(ir),
        mantenibilidadPipeline: scoreMantenibilidadPipeline(ir),
    };
}


export function applyQualityCaps(ir: DiagramIR, issues: DiagramLintIssue[], rawScore: number): number {
    if (ir.nodes.length === 0) return 0;
    // Skeleton fallback is a deliberate placeholder; cap the score so the
    // user is nudged to regenerate with more context instead of treating it
    // as a finished diagram.
    if (ir.metadata?.fallback === 'skeleton') return Math.min(rawScore, 40);

    let capped = rawScore;
    const brokenEdges = issues.some((i) => i.code === 'EDGE_INVALID_REFERENCE');
    const missingEdgeLabels = issues.some((i) => i.code === 'EDGE_MISSING_LABEL');

    if (brokenEdges) capped = Math.min(capped, 40);
    if (missingEdgeLabels) capped = Math.min(capped, 60);

    const c4Requested = (ir.metadata?.title ?? '').toLowerCase().includes('c4')
        || ir.nodes.some((n) => /^(person|system|container|component|node|deployment)/i.test(n.kind ?? ''));
    if (c4Requested && ir.nodes.length < 2) capped = Math.min(capped, 50);

    if (ir.metadata?.degradationReason?.includes('audience-empty')) {
        capped = Math.min(capped, 30);
    }

    return capped;
}

export function issuePenalty(issues: DiagramLintIssue[]): number {
    return issues.reduce((acc, i) => {
        if (i.severity === 'critical') return acc + 6;
        if (i.severity === 'high') return acc + 3;
        if (i.severity === 'medium') return acc + 1.5;
        return acc + 0.5;
    }, 0);
}

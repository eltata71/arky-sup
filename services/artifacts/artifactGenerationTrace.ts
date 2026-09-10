/**
 * The trace an artifact generation leaves behind, and the small decisions the
 * pipeline makes on the way.
 *
 * The trace is not logging. `ArtifactGenerationTrace` is what the canvas's
 * trace panel shows an architect when an artifact looks wrong, so its
 * `status` is load-bearing: a run that fell back to a deterministic skeleton
 * must never read as `clean`, or the panel tells the user the output is fine
 * when it is a placeholder.
 */

import type { ArtifactGenerationTrace, ArtifactGenerationTraceStep, ArtifactTemplate } from '../../types';
import type { DiagramAudience, DiagramErrorRecord, DiagramIR } from '../../lib/diagram';
import type { resolveEffectiveModel } from '../../lib/ai/modelCatalog';
import type { buildArtifactGenerationGraphContext } from '../architectureKnowledgeGraph';
import type { ArtifactRefinementMode } from './artifactRefinementOrchestrator';

export type ArtifactGenerationAction = 'create' | 'replace' | 'new_version';

/**
 * `mixed` biases towards technical because architects ultimately consume the
 * diagram; the projector layer can downscale to executive on demand.
 */
export const mapRequestAudienceToDiagramAudience = (
    audience?: 'technical' | 'executive' | 'mixed',
): DiagramAudience => {
    if (audience === 'executive') return 'executive';
    if (audience === 'mixed') return 'technical';
    return 'technical';
};

export const resolveRefinementMode = (template: ArtifactTemplate): ArtifactRefinementMode => {
    if (template.type === 'hybrid-text-diagram' || template.representation === 'hybrid') return 'hybrid';
    if (template.type.startsWith('mermaid') || template.type === 'react-flow-graph' || template.representation === 'diagram') return 'diagram';
    if (template.type === 'sdd-traceability') return 'table';
    return 'document';
};

/**
 * Swaps the normalised Mermaid into `content`.
 *
 * A hybrid artifact keeps its prose and only its fenced block is replaced; a
 * pure-diagram artifact has no prose to keep, so the Mermaid *is* the content.
 */
export const replaceMermaidBlock = (content: string, mermaid: string): string => {
    const fenced = /```mermaid\s*[\s\S]*?```/m;
    if (fenced.test(content)) {
        return content.replace(fenced, `\`\`\`mermaid\n${mermaid}\n\`\`\``);
    }
    return mermaid;
};

export const makeTraceStep = (
    stage: ArtifactGenerationTraceStep['stage'],
    status: ArtifactGenerationTraceStep['status'],
    message: string,
    detail?: string,
): ArtifactGenerationTraceStep => ({
    stage,
    status,
    message,
    detail,
    at: new Date().toISOString(),
});

/**
 * The two step lists a run accumulates, carried together because every stage
 * appends to one or the other and the trace needs both.
 */
export interface TraceLog {
    /** What the pipeline did and why. */
    decisions: ArtifactGenerationTraceStep[];
    /** What went wrong, at any severity — this is what decides `status`. */
    errors: ArtifactGenerationTraceStep[];
}

export const createTraceLog = (initial: ArtifactGenerationTraceStep[] = []): TraceLog => ({
    decisions: [...initial],
    errors: [],
});

export interface BuildGenerationTraceInput {
    log: TraceLog;
    template: ArtifactTemplate;
    action: ArtifactGenerationAction;
    operationId: string;
    startedAt: string;
    startedMs: number;
    persistedContent: string;
    ir: DiagramIR | null;
    /** Non-null when a deterministic skeleton stood in for the AI output. */
    skeletonFallbackError: DiagramErrorRecord | null;
    /** The refinement orchestrator is the source of truth for document fallbacks. */
    refinementFallbackDetected: boolean;
    quality: ArtifactGenerationTrace['quality'];
    renderCounters?: { nodes: number; edges: number };
    modelPreference?: string;
    generationModel: ReturnType<typeof resolveEffectiveModel>;
    architectureGraph: ReturnType<typeof buildArtifactGenerationGraphContext>['usage'];
}

export function buildGenerationTrace({
    log,
    template,
    action,
    operationId,
    startedAt,
    startedMs,
    persistedContent,
    ir,
    skeletonFallbackError,
    refinementFallbackDetected,
    quality: qualityGateSummary,
    renderCounters,
    modelPreference,
    generationModel,
    architectureGraph,
}: BuildGenerationTraceInput): ArtifactGenerationTrace {
    const traceDecisions = log.decisions;
    const traceErrors = log.errors;
    const completedAt = new Date().toISOString();
    return {
        id: `trace-${Date.now()}`,
        operationId: operationId,
        source: template.requestContext ? 'on-demand' : action === 'new_version' || action === 'replace' ? 'regeneration' : 'catalog',
        // A deterministic fallback — diagram skeleton OR document fallback —
        // must never surface as `clean`; the refinement orchestrator is the
        // single source of truth for document-fallback detection.
        status: (skeletonFallbackError || refinementFallbackDetected) ? 'fallback' : traceErrors.some(step => step.status === 'error') ? 'failed' : traceErrors.length > 0 ? 'warning' : 'clean',
        startedAt,
        completedAt,
        durationMs: Date.now() - startedMs,
        // `model` is kept for backwards compatibility (mirrors the user's
        // preference). `modelEffective` is the new source of truth and
        // records the actual id, the configuration source, and the tier.
        model: modelPreference,
        modelEffective: {
            id: generationModel.id,
            source: generationModel.source,
            tier: generationModel.tier,
            requested: generationModel.requested,
        },
        request: template.requestContext,
        matchedCatalogTemplateName: template.requestContext?.matchedCatalogTemplateName,
        quality: qualityGateSummary,
        decisions: [
            ...traceDecisions,
            makeTraceStep('persistence', 'success', 'Artefacto preparado para persistencia local/remota.', `Estado de generación: ${(skeletonFallbackError || refinementFallbackDetected) ? 'fallback' : traceErrors.length > 0 ? 'warning' : 'clean'}.`),
        ],
        errors: traceErrors,
        warnings: traceErrors.filter(step => step.status === 'warning').map(step => step.message),
        contentLength: persistedContent.length,
        irCounters: ir ? { nodes: ir.nodes.length, edges: ir.edges.length, groups: ir.groups?.length ?? 0 } : { nodes: 0, edges: 0, groups: 0 },
        renderCounters,
        lifecycle: [
            'generated',
            'validated',
            'persisted-local',
            renderCounters && renderCounters.nodes > 0 ? 'render-ready' : 'render-fallback',
            'opened',
        ],
        persistence: { local: 'success', remote: 'pending' },
        contentPreview: persistedContent.slice(0, 500),
        architectureGraph,
    };
}

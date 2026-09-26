/**
 * The renderability safety net.
 *
 * The product's hard rule for generation is that **the canvas never opens
 * blank**. Model output can be empty, unparseable, or parse into an IR with
 * no visible nodes, and in each case something renderable has to reach the
 * artifact anyway — a deterministic skeleton the architect can edit or
 * regenerate from, never nothing.
 *
 * The other half of the rule is that a fallback is always *declared*: every
 * substitution here writes a `DiagramErrorRecord` and a trace step, so the
 * run cannot later report itself as clean. Silently persisting a placeholder
 * is the failure mode this module exists to prevent.
 */

import type { ArtifactTemplate } from '../../../types';
import type { ArtifactGenerationPhaseListener } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import type { DiagramErrorRecord, DiagramIR } from '../../../lib/diagram';
import {
    buildDeterministicArtifactFallback,
    buildDeterministicDiagramSkeleton,
    isSkeletonFallbackContent,
} from '../domain/deterministicArtifactFallbacks';
import { extractIRFromArtifact } from '../../diagram';
import { irToReactFlow } from '../../diagram/irToReactFlow';
import { makeTraceStep, type TraceLog } from '../domain/artifactGenerationTrace';

export interface DiagramFallbackContext {
    project: Project;
    template: ArtifactTemplate;
    /** Only a diagram can be repaired with a skeleton; a document gets prose. */
    isDiagramTemplate: boolean;
    log: TraceLog;
}

/**
 * The content and IR a run is carrying, mutated in place as each safety net
 * fires. `content` stays as the model returned it so fallback records can
 * quote the original sample; `resolvedContent` is what will be persisted.
 */
export interface DiagramDraft {
    content: string;
    resolvedContent: string;
    ir: DiagramIR | null;
    skeletonFallbackError: DiagramErrorRecord | null;
}

/**
 * First net: the model returned nothing at all.
 *
 * Returns the content to continue with — a diagram skeleton or a document
 * fallback — and the record of the substitution, or the original content
 * untouched when there was something to work with.
 */
export function substituteEmptyContent(
    { project, template, isDiagramTemplate, log }: DiagramFallbackContext,
    generatedContent: string,
    onPhase?: ArtifactGenerationPhaseListener,
): { content: string; skeletonFallbackError: DiagramErrorRecord | null } {
    const traceErrors = log.errors;
    let content = generatedContent;
    let skeletonFallbackError: DiagramErrorRecord | null = null;
    if (!content || content.trim().length === 0) {
        console.warn('[artifactGeneration] Generation returned empty content; substituting deterministic fallback.', {
            artifactName: template.name,
            type: template.type,
        });
        content = isDiagramTemplate
            ? buildDeterministicDiagramSkeleton(project, template)
            : buildDeterministicArtifactFallback(project, template);
        traceErrors.push(makeTraceStep('fallback', 'warning', 'Gemini devolvió contenido vacío; se construyó fallback local antes de persistir.', 'La solicitud original se conserva en el contexto del artefacto.'));
        skeletonFallbackError = isDiagramTemplate ? {
            reason: 'skeleton-fallback',
            attempt: 1,
            at: new Date().toISOString(),
            sample: '',
            message: 'La generación IA devolvió contenido vacío; se persistió un fallback local renderizable.',
        } : null;
        onPhase?.({
            stage: 'fallback',
            status: 'warning',
            message: 'Gemini devolvió contenido vacío; usando fallback local visible y editable.',
            at: new Date().toISOString(),
            meta: { artifactType: template.type, fallback: 'local-empty-content' },
        });
    }
    return { content, skeletonFallbackError };
}

/**
 * Second net: the content parsed into no IR, or into an IR with no nodes.
 *
 * Also catches the case the original code learned the hard way — a *previous*
 * fallback that happens to be a valid diagram, which parses cleanly and would
 * otherwise be reported as a successful generation. The skeleton marker is
 * checked before any quality normalisation can strip the Mermaid comment that
 * carries it.
 *
 * Mutates `draft`, and calls `onWarning` when the artifact ends up on a
 * skeleton so the caller can tell the user it is a placeholder.
 */
export function ensureRenderableDiagram(
    draft: DiagramDraft,
    { project, template, isDiagramTemplate, log }: DiagramFallbackContext,
    onWarning?: (message: string) => void,
): void {
    const traceErrors = log.errors;
    const { content } = draft;
    let { resolvedContent, ir, skeletonFallbackError } = draft;
    // Root-cause hardening: renderability fallbacks can be valid diagrams,
    // so IR extraction succeeds and the old logic marked them as "clean".
    // Detect the explicit skeleton marker before any quality normalization
    // can strip Mermaid comments, persist lastDiagramError, and keep the
    // trace honest for support/debugging.
    if (isDiagramTemplate && isSkeletonFallbackContent(resolvedContent) && !skeletonFallbackError) {
        traceErrors.push(makeTraceStep(
            'fallback',
            'warning',
            'Se persistió un fallback determinístico renderizable para evitar un canvas vacío.',
            'La generación original no produjo una estructura suficientemente confiable; el artefacto queda editable y trazable.',
        ));
        skeletonFallbackError = {
            reason: 'skeleton-fallback',
            attempt: 3,
            at: new Date().toISOString(),
            sample: content.slice(0, 500),
            message: 'La generación produjo o requirió un esqueleto local renderizable; revisar la traza técnica antes de continuar.',
        };
    }
    if (isDiagramTemplate && (!ir || ir.nodes.length === 0)) {
        console.warn(
            '[artifactGeneration] Diagram artifact has no parseable IR — substituting deterministic skeleton.',
            {
                artifactName: template.name,
                type: template.type,
                contentLength: content.length,
                contentPreview: content.slice(0, 240),
            },
        );
        // Last-resort safety net: when the AI's output is unparseable we
        // still must persist *something* renderable, otherwise the
        // canvas opens blank and the user loses the click context. Swap
        // in the deterministic skeleton for the requested template type
        // and re-parse it; this guarantees a diagram appears (with the
        // option to regenerate from the toolbar).
        try {
            const skeleton = buildDeterministicDiagramSkeleton(project, template);
            const skeletonIR = extractIRFromArtifact({
                content: skeleton,
                representation: template.representation,
                type: template.type,
            });
            if (skeletonIR && skeletonIR.nodes.length > 0) {
                resolvedContent = skeleton;
                ir = skeletonIR;
                traceErrors.push(makeTraceStep('fallback', 'warning', 'Se sustituyó la salida por un esqueleto determinístico renderizable.', 'La salida original no produjo IR con nodos visibles.'));
                skeletonFallbackError = {
                    reason: 'skeleton-fallback',
                    attempt: 3,
                    at: new Date().toISOString(),
                    sample: content.slice(0, 500),
                    message: 'La generación a solicitud produjo contenido sin IR parseable; se persistió un esqueleto local renderizable para evitar un canvas vacío.',
                };
            }
        } catch (err) {
            console.warn('[artifactGeneration] Skeleton substitution threw', err);
        }
        if (!skeletonFallbackError) {
            traceErrors.push(makeTraceStep('fallback', 'error', 'No fue posible construir un esqueleto determinístico completo.', 'El artefacto puede requerir regeneración o edición manual.'));
            skeletonFallbackError = {
                reason: 'empty-ir',
                attempt: 3,
                at: new Date().toISOString(),
                sample: content.slice(0, 500),
                message: 'La generación a solicitud produjo contenido sin IR parseable y no fue posible construir el esqueleto local.',
            };
        }
        onWarning?.(
            `Generación de "${template.name}" completada con un esqueleto de respaldo. Pulsa "Generar de Nuevo" para reintentar la versión completa.`,
        );
    }

    draft.resolvedContent = resolvedContent;
    draft.ir = ir;
    draft.skeletonFallbackError = skeletonFallbackError;
}

/**
 * Third net, and the one that answers the question the trace panel is really
 * asked: how many nodes actually reached the canvas?
 *
 * Runs the same ReactFlow projection the canvas will run, so a diagram that
 * renders to nothing is caught here rather than in front of the user. A
 * projection that throws is a warning, not a failure: the canvas has its own
 * placeholder, and refusing to persist would lose the generated content.
 */
export function measureRenderCounters(
    draft: DiagramDraft,
    { project, template, isDiagramTemplate, log }: DiagramFallbackContext,
): { nodes: number; edges: number } | undefined {
    const traceErrors = log.errors;
    const traceDecisions = log.decisions;
    const { content } = draft;
    let { resolvedContent, ir, skeletonFallbackError } = draft;
    let renderCounters: { nodes: number; edges: number } | undefined;
    if (isDiagramTemplate) {
        if (!ir || ir.nodes.length === 0) {
            const skeleton = buildDeterministicDiagramSkeleton(project, template);
            const skeletonIR = extractIRFromArtifact({ content: skeleton, representation: template.representation, type: template.type });
            if (skeletonIR?.nodes.length) {
                resolvedContent = skeleton;
                ir = skeletonIR;
                skeletonFallbackError = skeletonFallbackError ?? {
                    reason: 'skeleton-fallback',
                    attempt: 4,
                    at: new Date().toISOString(),
                    sample: content.slice(0, 500),
                    message: 'Validación final detectó diagrama no renderizable; se usó fallback local.',
                };
                traceErrors.push(makeTraceStep('fallback', 'warning', 'Validación final sustituyó contenido no renderizable por fallback local.'));
            }
        }
        if (ir) {
            try {
                const rendered = irToReactFlow(ir, { allowEmptyPlaceholder: true });
                renderCounters = { nodes: rendered.nodes.length, edges: rendered.edges.length };
                if (rendered.nodes.length === 0) {
                    traceErrors.push(makeTraceStep('render', 'error', 'ReactFlow final no produjo nodos visibles antes de persistir.'));
                } else {
                    traceDecisions.push(makeTraceStep('render', 'success', 'ReactFlow final validado antes de persistir.', `${rendered.nodes.length} nodos · ${rendered.edges.length} relaciones.`));
                }
            } catch (err) {
                traceErrors.push(makeTraceStep('render', 'warning', 'No fue posible validar ReactFlow antes de persistir; el canvas aplicará placeholder local.', err instanceof Error ? err.message : String(err)));
            }
        }
    }
    draft.resolvedContent = resolvedContent;
    draft.ir = ir;
    draft.skeletonFallbackError = skeletonFallbackError;
    return renderCounters;
}

/** Re-exported so the run module has a single import for the fallback ladder. */
export { isSkeletonFallbackContent };

/**
 * One run of the artifact generation pipeline, without a screen around it.
 *
 * This is what `Workspace.tsx` used to hold inline: 450 lines between the
 * "Generar" click and the write, covering generation, three layers of
 * deterministic fallback, the diagram quality gate, render validation,
 * semantic refinement and the trace that records all of it.
 *
 * Pulling it out of the component is not cosmetic. The pipeline's whole
 * purpose is that **a failure never reaches the user as a blank canvas** —
 * every degradation persists something renderable and says so in the trace —
 * and that property was only reachable through a React tree, an AI provider
 * and a Firestore write. Here it is an async function over plain values.
 *
 * What stays in the component: the React state it drives (`isGenerating`, the
 * active artifact), the write itself, and the error-to-toast mapping. What
 * comes back is everything needed to perform that write.
 */

import type { ArtifactTemplate, Settings } from '../../../types';
import type { Artifact, ArtifactGenerationPhaseListener, ArtifactGenerationTrace, ArtifactPersonaComposer } from '../../../lib/artifacts';
import type { Project } from '../../architectureProjects';
import type { DiagramAudience, DiagramErrorRecord, DiagramIR } from '../../../lib/diagram';
import { artifactGenerationService } from '../../ai';
import { resolveEffectiveModel } from '../../../lib/ai/modelCatalog';
import { extractIRFromArtifact } from '../../diagram';
import { runDiagramQualityGate } from '../../diagram/qualityGate';
import { irToMermaid } from '../../diagram/irToMermaid';
import { irToReactFlow } from '../../diagram/irToReactFlow';
import {
    buildArtifactPipelineTraceSteps,
    normalizeArtifactEnvelope,
    validateArtifactEnvelope,
} from './artifactGenerationPipeline';
import {
    buildArtifactGenerationGraphContext,
    resolveProjectArchitectureGraphFreshness,
} from '../../architectureKnowledgeGraph';
import { refineArtifactBeforePersistence } from './artifactRefinementOrchestrator';
import { artifactGenerationSupport } from '../domain/artifactGenerationSupport';
import {
    buildGenerationTrace,
    createTraceLog,
    makeTraceStep,
    mapRequestAudienceToDiagramAudience,
    replaceMermaidBlock,
    resolveRefinementMode,
    type ArtifactGenerationAction,
} from '../domain/artifactGenerationTrace';
import {
    ensureRenderableDiagram,
    measureRenderCounters,
    substituteEmptyContent,
    type DiagramDraft,
    type DiagramFallbackContext,
} from './artifactGenerationFallbacks';

export type { ArtifactGenerationAction } from '../domain/artifactGenerationTrace';



export interface ArtifactGenerationRunInput {
    project: Project;
    template: ArtifactTemplate;
    settings: Settings;
    /** The artifact being replaced or versioned; absent when creating. */
    existingArtifact?: Artifact;
    action: ArtifactGenerationAction;
    /** Correlates the run with the observability operation the caller opened. */
    operationId: string;
    startedAt: string;
    startedMs: number;
    onPhase?: ArtifactGenerationPhaseListener;
    /** Who speaks in the prompt; handed in because only the Office knows (corte 13). */
    composePersonaInstruction?: ArtifactPersonaComposer;
    /**
     * Told when the run degraded to a fallback the user should know about.
     * A callback rather than a toast: this module has no screen.
     */
    onWarning?: (message: string) => void;
}

export interface ArtifactGenerationRunResult {
    /** Exactly what the provider returned, kept for the trace panel. */
    generatedContent: string;
    /** What to persist: refined content, or a renderable fallback. */
    persistedContent: string;
    ir: DiagramIR | null;
    persistedAudience?: DiagramAudience;
    generationTrace: ArtifactGenerationTrace;
    persistedEnvelope: ReturnType<typeof normalizeArtifactEnvelope>;
    /** Non-null when a deterministic skeleton stood in for the AI output. */
    skeletonFallbackError: DiagramErrorRecord | null;
}

export async function runArtifactGeneration({
    project,
    template,
    settings,
    existingArtifact,
    action,
    operationId,
    startedAt,
    startedMs,
    onPhase,
    composePersonaInstruction,
    onWarning,
}: ArtifactGenerationRunInput): Promise<ArtifactGenerationRunResult> {
    const log = createTraceLog([
        makeTraceStep(
            template.requestContext ? 'recommendation' : 'prompt',
            'success',
            template.requestContext
                ? 'Se generó desde Artefacto a solicitud con recomendación aprobada.'
                : 'Se generó desde plantilla de catálogo.',
            template.requestContext?.rationale ?? `Plantilla: ${template.name}`,
        ),
    ]);
    const { decisions: traceDecisions, errors: traceErrors } = log;

    // Resolve the model up-front from the single source of truth so the trace
    // (and the canvas trace panel) reflect the model that actually hit the
    // SDK — not just the user's preference. This also captures `source` so
    // reviewers can see which configuration layer (user/global/tier-floor)
    // won the precedence chain.
    const generationModel = resolveEffectiveModel('default', settings);
    traceDecisions.push(makeTraceStep(
        'ai-generation',
        'success',
        'Se invocó el servicio Gemini mediante la capa services/.',
        `Modelo efectivo: ${generationModel.id} · fuente: ${generationModel.source}${generationModel.requested && generationModel.requested !== generationModel.id ? ` (preferencia: ${generationModel.requested})` : ''}.`,
    ));
    // Architecture Knowledge Graph as canonical generation context: build
    // a budgeted, type/intent/audience-ranked prompt block from the
    // persisted graph. Degrades safely to an empty block when the project
    // has no graph yet, so legacy projects generate exactly as before.
    const graphFreshness = resolveProjectArchitectureGraphFreshness(project, {
        globalContext: settings.globalContext,
    });
    const graphGenerationContext = buildArtifactGenerationGraphContext(
        project.architectureKnowledgeGraph,
        graphFreshness,
        {
            artifactType: template.type,
            audience: template.requestContext?.audience,
            intent: template.requestContext?.userRequest ?? template.objective,
            language: settings.language,
        },
    );
    if (graphGenerationContext.usage.used) {
        traceDecisions.push(makeTraceStep(
            'prompt',
            graphFreshness === 'stale' ? 'warning' : 'success',
            'Se incorporó el grafo de conocimiento arquitectónico al contexto de generación.',
            `buildId ${graphGenerationContext.usage.buildId ?? 'n/d'} · `
                + `${graphGenerationContext.usage.entitiesIncluded} entidades · `
                + `${graphGenerationContext.usage.relationsIncluded} relaciones · `
                + `${graphGenerationContext.usage.consistencyIssueCount} inconsistencia(s) · `
                + `${graphGenerationContext.usage.traceabilityGapCount} vacío(s) de trazabilidad · `
                + `frescura ${graphFreshness}.`,
        ));
    }
    const generatedContent = await artifactGenerationService.generateArtifactContent(
        project,
        template,
        settings,
        existingArtifact,
        { onPhase, architectureGraphPromptBlock: graphGenerationContext.promptBlock, composePersonaInstruction, support: artifactGenerationSupport },
    );
    const initialEnvelope = normalizeArtifactEnvelope({
        artifactId: existingArtifact?.id ?? operationId,
        title: template.name,
        artifactType: template.type,
        representation: template.representation,
        rawResponse: generatedContent,
        intent: template.requestContext ? 'on-demand' : action === 'create' ? 'catalog' : 'regeneration',
        audience: template.requestContext?.audience === 'mixed' ? 'mixed' : mapRequestAudienceToDiagramAudience(template.requestContext?.audience),
    });
    const envelopeValidation = validateArtifactEnvelope(initialEnvelope);
    traceDecisions.push(...buildArtifactPipelineTraceSteps(initialEnvelope));
    if (!envelopeValidation.ok) {
        traceErrors.push(makeTraceStep('validation', 'error', 'El envelope normalizado no tiene una vista renderizable.', envelopeValidation.diagnostics[0]?.message));
    } else if (envelopeValidation.status !== 'ready') {
        traceErrors.push(makeTraceStep('validation', 'warning', 'El envelope normalizado requiere fallback o revisión.', `vista=${envelopeValidation.visibleViewMode ?? 'none'} status=${envelopeValidation.status}`));
    }

    const isDiagramTemplate = template.type.startsWith('mermaid') || template.type === 'react-flow-graph' || template.type === 'hybrid-text-diagram';
    const fallbackContext: DiagramFallbackContext = { project, template, isDiagramTemplate, log };
    const { content, skeletonFallbackError } = substituteEmptyContent(fallbackContext, generatedContent, onPhase);
    traceDecisions.push(makeTraceStep('validation', 'success', 'Contenido no vacío recibido desde la generación.', `${content.trim().length} caracteres.`));
    onPhase?.({
        stage: 'validation',
        status: 'success',
        message: `Contenido recibido (${content.trim().length} caracteres). Iniciando validación estructural.`,
        at: new Date().toISOString(),
        meta: { operationId: operationId, contentLength: content.trim().length },
    });

    // Post-generation canonical IR extraction — lets downstream consumers
    // (quality scorer, audience projector, PDF brief) run without parsing
    // the Mermaid/JSON again. Failing here must NOT block the save, but
    // we WARN explicitly so the empty-canvas regression is debuggable.
    let qualityGateSummary: ArtifactGenerationTrace['quality'];
    const draft: DiagramDraft = {
        content,
        resolvedContent: content,
        ir: (() => {
            try {
                return extractIRFromArtifact({ content, representation: template.representation, type: template.type });
            } catch (err) {
                console.warn(
                    '[artifactGeneration] extractIRFromArtifact threw — artifact will be saved without persisted IR.',
                    { artifactName: template.name, type: template.type, error: err },
                );
                traceErrors.push(makeTraceStep('validation', 'warning', 'No fue posible extraer IR canónico del contenido generado.', err instanceof Error ? err.message : String(err)));
                return null;
            }
        })(),
        skeletonFallbackError,
    };
    if (draft.ir && draft.ir.nodes.length > 0) {
        traceDecisions.push(makeTraceStep('validation', 'success', 'IR canónico extraído correctamente.', `${draft.ir.nodes.length} nodos · ${draft.ir.edges.length} relaciones.`));
    }

    ensureRenderableDiagram(draft, fallbackContext, onWarning);
    if (isDiagramTemplate && draft.ir && draft.ir.nodes.length > 0) {
        try {
            const qualityGate = runDiagramQualityGate(draft.ir, {
                artifact: {
                    name: template.name,
                    type: template.type,
                    objective: template.objective,
                    audience: mapRequestAudienceToDiagramAudience(template.requestContext?.audience),
                },
                audience: mapRequestAudienceToDiagramAudience(template.requestContext?.audience),
                targetScore: template.requestContext ? 92 : 90,
                maxPasses: template.requestContext ? 4 : 3,
                aggressive: Boolean(template.requestContext),
            });
            const qualityGateIR = qualityGate.ir.nodes.length >= draft.ir.nodes.length ? qualityGate.ir : draft.ir;
            if (qualityGate.ir.nodes.length < draft.ir.nodes.length) {
                traceErrors.push(makeTraceStep('quality-gate', 'warning', 'Quality gate descartado porque redujo nodos.', `${qualityGate.ir.nodes.length}/${draft.ir.nodes.length} nodos.`));
            }
            draft.ir = qualityGateIR;
            qualityGateSummary = {
                score: qualityGate.quality.score,
                reachedTarget: qualityGate.reachedTarget,
                changeCount: qualityGate.changes.length,
                history: qualityGate.history,
            };
            traceDecisions.push(makeTraceStep(
                'quality-gate',
                qualityGate.reachedTarget ? 'success' : 'warning',
                `Quality gate determinístico aplicado: score ${qualityGate.quality.score}/100.`,
                `${qualityGate.changes.length} mejoras · target ${template.requestContext ? 92 : 90} · ${qualityGate.reachedTarget ? 'alcanzado' : 'pendiente'}.`,
            ));
            onPhase?.({
                stage: 'quality-gate',
                status: qualityGate.reachedTarget ? 'success' : 'warning',
                message: `Quality gate aplicado · score ${qualityGate.quality.score}/100${qualityGate.reachedTarget ? ' (target alcanzado)' : ' (target pendiente)'}.`,
                detail: `${qualityGate.changes.length} mejoras automáticas aplicadas.`,
                at: new Date().toISOString(),
                meta: {
                    score: qualityGate.quality.score,
                    target: template.requestContext ? 92 : 90,
                    changes: qualityGate.changes.length,
                    reachedTarget: qualityGate.reachedTarget,
                },
            });
            if (!qualityGate.reachedTarget) {
                traceErrors.push(makeTraceStep('quality-gate', 'warning', 'El artefacto quedó por debajo del objetivo de calidad.', qualityGate.quality.summary));
            }
            const normalizedMermaid = irToMermaid(draft.ir);
            if (template.type === 'hybrid-text-diagram') {
                draft.resolvedContent = replaceMermaidBlock(draft.resolvedContent, normalizedMermaid);
            } else if (template.type.startsWith('mermaid') && !template.type.startsWith('mermaid-c4-')) {
                draft.resolvedContent = normalizedMermaid;
            }
        } catch (err) {
            traceErrors.push(makeTraceStep('quality-gate', 'warning', 'El quality gate no pudo ejecutarse; se conserva el contenido validado.', err instanceof Error ? err.message : String(err)));
        }
    } else if (isDiagramTemplate) {
        traceErrors.push(makeTraceStep('quality-gate', 'skipped', 'Quality gate omitido porque no existe IR con nodos.'));
    }

    let renderCounters = measureRenderCounters(draft, fallbackContext);

    // Persist the audience derived from the on-demand request so the
    // canvas opens with the same audience the architect asked for. Without
    // this, the canvas defaults to 'technical' and the audience projector
    // can hide nodes the user explicitly requested for an executive or
    // mixed view — surfacing as the "empty canvas" failure mode.
    const persistedAudience = template.requestContext
        ? mapRequestAudienceToDiagramAudience(template.requestContext.audience)
        : undefined;

    let refinedEnvelopeForPersistence: ReturnType<typeof normalizeArtifactEnvelope> | undefined;
    let refinementFallbackDetected = false;
    try {
        const refinementEnvelope = normalizeArtifactEnvelope({
            artifactId: existingArtifact?.id ?? operationId,
            title: template.name,
            artifactType: template.type,
            representation: template.representation,
            rawResponse: draft.resolvedContent,
            intent: template.requestContext ? 'on-demand' : action === 'create' ? 'catalog' : 'regeneration',
            audience: persistedAudience ?? mapRequestAudienceToDiagramAudience(template.requestContext?.audience),
        });
        const refinement = await refineArtifactBeforePersistence({
            project,
            template,
            settings,
            draftContent: draft.resolvedContent,
            previousArtifact: existingArtifact,
            envelope: refinementEnvelope,
            targetScore: template.requestContext
                ? (isDiagramTemplate ? 92 : 90)
                : (isDiagramTemplate ? 90 : 85),
            maxPasses: 2,
            mode: resolveRefinementMode(template),
            operationId: operationId,
            onPhase,
            lastDiagramError: skeletonFallbackError ?? undefined,
            generationTraceStatus: skeletonFallbackError ? 'fallback' : undefined,
        });
        refinementFallbackDetected = refinement.fallbackDetected;
        const refinementErrors = refinement.diagnostics.filter(step => step.status === 'warning' || step.status === 'error');
        traceDecisions.push(...refinement.diagnostics.filter(step => step.status !== 'warning' && step.status !== 'error'));
        traceErrors.push(...refinementErrors);
        if (refinement.warnings.length > 0) {
            traceErrors.push(makeTraceStep('refinement', 'warning', 'Refinamiento completado con advertencias observables.', refinement.warnings.join(' | ').slice(0, 800)));
        }
        qualityGateSummary = {
            ...(qualityGateSummary ?? {}),
            score: refinement.finalScore,
            reachedTarget: refinement.finalScore >= (template.requestContext ? (isDiagramTemplate ? 92 : 90) : (isDiagramTemplate ? 90 : 85)),
            changeCount: (qualityGateSummary?.changeCount ?? 0) + refinement.passes.filter(pass => pass.changed).length,
            history: [
                ...(qualityGateSummary?.history ?? []),
                ...refinement.passes.map(pass => ({ pass: pass.passNumber, score: pass.afterScore, changeCount: pass.changed ? 1 : 0 })),
            ],
            initialScore: refinement.initialScore,
            finalScore: refinement.finalScore,
            refinementPasses: refinement.passes.length,
            refinementAccepted: refinement.accepted,
            refinementWarnings: refinement.warnings.length,
            refinementUsedAI: refinement.usedAI,
            refinementFallbackDetected: refinement.fallbackDetected,
            refinementRejectedCandidates: refinement.rejectedCandidates,
            refinementSafetyFailures: refinement.safetyFailures,
            refinementImprovedDimensions: refinement.improvedDimensions,
        };
        if (refinement.accepted && refinement.content.trim()) {
            draft.resolvedContent = refinement.content;
            refinedEnvelopeForPersistence = refinement.envelope;
            if (isDiagramTemplate) {
                const refinedIR = extractIRFromArtifact({ content: draft.resolvedContent, representation: template.representation, type: template.type });
                if (refinedIR && (!draft.ir || refinedIR.nodes.length >= draft.ir.nodes.length)) {
                    draft.ir = refinedIR;
                    try {
                        const rendered = irToReactFlow(draft.ir, { allowEmptyPlaceholder: true });
                        renderCounters = { nodes: rendered.nodes.length, edges: rendered.edges.length };
                        traceDecisions.push(makeTraceStep('render', 'success', 'ReactFlow revalidado después del refinamiento.', `${rendered.nodes.length} nodos · ${rendered.edges.length} relaciones.`));
                    } catch (err) {
                        traceErrors.push(makeTraceStep('render', 'warning', 'No fue posible revalidar ReactFlow tras refinamiento; se conserva fallback de canvas.', err instanceof Error ? err.message : String(err)));
                    }
                } else if (draft.ir) {
                    traceErrors.push(makeTraceStep('refinement', 'warning', 'Refinamiento aceptado sin reemplazar IR porque no mejoró el conteo de nodos.'));
                }
            }
        }
    } catch (err) {
        traceErrors.push(makeTraceStep('refinement', 'warning', 'El refinamiento falló sin bloquear la persistencia; se conserva contenido validado.', err instanceof Error ? err.message : String(err)));
    }

    // From here on, persist `draft.resolvedContent` (skeleton when AI failed,
    // original/refined content otherwise) and the matching `draft.ir`.
    const persistedContent = draft.resolvedContent;
    const generationTrace = buildGenerationTrace({
        log,
        template,
        action,
        operationId,
        startedAt,
        startedMs,
        persistedContent,
        ir: draft.ir,
        skeletonFallbackError: draft.skeletonFallbackError,
        refinementFallbackDetected,
        quality: qualityGateSummary,
        renderCounters,
        modelPreference: settings.aiConfig?.model,
        generationModel,
        architectureGraph: graphGenerationContext.usage,
    });

    const persistedEnvelope = refinedEnvelopeForPersistence ?? normalizeArtifactEnvelope({
        artifactId: existingArtifact?.id ?? generationTrace.id,
        title: template.name,
        artifactType: template.type,
        representation: template.representation,
        rawResponse: persistedContent,
        intent: generationTrace.source === 'on-demand' ? 'on-demand' : generationTrace.source === 'regeneration' ? 'regeneration' : 'catalog',
        audience: persistedAudience ?? mapRequestAudienceToDiagramAudience(template.requestContext?.audience),
    });

    return {
        generatedContent,
        persistedContent,
        ir: draft.ir,
        persistedAudience,
        generationTrace,
        persistedEnvelope,
        skeletonFallbackError: draft.skeletonFallbackError,
    };
}

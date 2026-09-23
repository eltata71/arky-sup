/**
 * Generate a diagram IR and improve it: the local quality gate, then at most
 * one critique-and-refine round. Moved out of the engine in F5-01 (corte 6).
 */
import type { Settings } from '../../../../types';
import type { Artifact } from '../../../../lib/artifacts';
import type { DiagramAudience, DiagramIR } from '../../../../lib/diagram';
import { cleanJsonString } from '../../../../utils';
import type { Project } from '../../../architectureProjects';
import { analyzeDiagramQuality, detectArchitecturalViolations, runDiagramQualityGate } from '../../../diagram';
import { resolveModelForSettings } from '../../catalog';
import {
    buildDiagramIRSchema,
    buildDialectInstruction,
    buildIRCritiquePrompt,
    buildIRRefinePrompt,
} from '../../prompts/diagramPrompts';
import { legacyTransport } from '../legacyTransport';
import { buildDiagramGenerationConfig, diagramTemperature } from './diagramGenerationConfig';
import { generateDiagramIR } from './diagramIRGeneration';

export async function generateAndRefineDiagramIR(
    artifact: Artifact,
    project: Project,
    settings: Settings,
    opts: {
        audience?: DiagramAudience;
        previousIR?: DiagramIR;
        /** Default: true. Skip auto-repair when false. */
        enableAutoRepair?: boolean;
        /** Default: true. Skip the AI critique+refine pass when false. */
        enableRefinement?: boolean;
        /**
         * Quality score (0–100) above which we skip the AI critique+refine
         * pass entirely. Default: 85.
         */
        skipRefinementAboveScore?: number;
    } = {},
): Promise<DiagramIR | null> {
    const {
        audience = artifact.audience ?? 'technical',
        previousIR,
        enableAutoRepair = true,
        enableRefinement = true,
        skipRefinementAboveScore = 85,
    } = opts;

    // Stage 1: draft.
    const draft = await generateDiagramIR(artifact, project, settings, { audience, previousIR });
    if (!draft) return null;

    // Stage 2: deterministic quality gate (architectural + structural
    // repairs).  Runs even when `enableAutoRepair` is false because the
    // gate guarantees a renderable IR with sane metadata, regardless of
    // whether the model emitted them.
    let working: DiagramIR = draft;
    if (enableAutoRepair) {
        const gate = runDiagramQualityGate(working, {
            artifact,
            audience,
            targetScore: 90,
            maxPasses: 3,
            // Generation is the right time to fully polish the diagram:
            // descriptions, label humanisation and id normalisation all
            // run so the persisted artifact starts at world-class.
            aggressive: true,
        });
        working = gate.ir;
        console.info('[geminiService.generateAndRefineDiagramIR] quality-gate', {
            applied: gate.changes.length,
            bestScore: gate.quality.score,
            reachedTarget: gate.reachedTarget,
            history: gate.history,
        });
    }

    // Early-out: if the repaired diagram is already excellent, skip refinement.
    const localQuality = analyzeDiagramQuality(working);
    if (!enableRefinement || localQuality.score >= skipRefinementAboveScore) {
        return attachQualityMetadata(working, localQuality);
    }

    // Stage 3+4: AI critique + refine.
    const remainingViolations = detectArchitecturalViolations(working, { type: artifact.type, audience });
    const refined = await runCritiqueAndRefine(
        working,
        artifact,
        audience,
        settings,
        remainingViolations,
        localQuality.issues,
    );
    if (!refined) return attachQualityMetadata(working, localQuality);

    // Re-run the deterministic gate over the refined IR so any regressions
    // the LLM introduced (broken refs, missing metadata, generic labels
    // re-injected into a previously fixed edge) are caught before persist.
    const postGate = runDiagramQualityGate(refined, {
        artifact,
        audience,
        targetScore: 90,
        maxPasses: 2,
        aggressive: true,
    });

    // Defensive: never let refinement *lower* the score by more than 5 points
    // — if it does, we keep the auto-repaired version instead.
    if (postGate.quality.score < localQuality.score - 5) {
        console.warn('[geminiService.generateAndRefineDiagramIR] refinement regressed score; keeping repaired draft', {
            draftScore: localQuality.score,
            refinedScore: postGate.quality.score,
        });
        return attachQualityMetadata(working, localQuality);
    }
    return attachQualityMetadata(postGate.ir, postGate.quality);
}

function attachQualityMetadata(ir: DiagramIR, quality: ReturnType<typeof analyzeDiagramQuality>): DiagramIR {
    const metadata = { ...(ir.metadata ?? {}) };
    metadata.qualityReview = {
        score: quality.score,
        issues: quality.issues.map((i) => ({
            severity: i.severity,
            message: i.message,
            recommendation: i.recommendation,
        })),
    };
    return { ...ir, metadata };
}

async function runCritiqueAndRefine(
    ir: DiagramIR,
    artifact: Artifact,
    audience: DiagramAudience,
    settings: Settings,
    architecturalViolations: ReturnType<typeof detectArchitecturalViolations>,
    detectedIssues: ReturnType<typeof analyzeDiagramQuality>['issues'],
): Promise<DiagramIR | null> {
    const modelName = resolveModelForSettings('default', settings).id;

    // Pass 3: critique (JSON only, low thinking — pure analysis).
    const critiquePrompt = buildIRCritiquePrompt({
        ir,
        artifact,
        audience,
        detectedIssues: detectedIssues.map((i) => ({
            severity: i.severity,
            message: i.message,
            recommendation: i.recommendation,
        })),
        architecturalViolations,
    });
    const critiqueConfig = buildDiagramGenerationConfig({
        temperature: 0.2,
        thinking: 'low',
        responseMimeType: 'application/json',
    });
    let critique: unknown = null;
    try {
        const text = await legacyTransport.generateTextWithFallback(settings, modelName, critiquePrompt, critiqueConfig);
        const cleanJson = cleanJsonString(text || '');
        if (cleanJson) critique = JSON.parse(cleanJson);
    } catch (err) {
        console.warn('[geminiService.runCritiqueAndRefine] critique pass failed; skipping refine', err);
        return null;
    }
    if (!critique) return null;

    // Pass 4: refine (returns full IR with embedded review).
    const responseSchema = buildDiagramIRSchema({ withReview: true });
    const refinePrompt = buildIRRefinePrompt({ ir, critique, artifact, audience });
    const refineConfig = buildDiagramGenerationConfig({
        temperature: diagramTemperature(settings.aiConfig?.temperature),
        thinking: 'low',
        responseSchema,
        extraSystemInstruction: buildDialectInstruction(artifact.type) || undefined,
    });
    try {
        const text = await legacyTransport.generateTextWithFallback(settings, modelName, refinePrompt, refineConfig);
        const cleanJson = cleanJsonString(text || '');
        if (!cleanJson) return null;
        const parsed = JSON.parse(cleanJson) as Partial<DiagramIR> & { error?: string };
        if (parsed.error || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) || parsed.nodes.length === 0) {
            return null;
        }
        const nodeIds = new Set(parsed.nodes.map((n) => n.id));
        const cleanEdges = parsed.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
        const cleanGroups = (Array.isArray(parsed.groups) ? parsed.groups : [])
            .map((g) => ({ ...g, nodeIds: g.nodeIds.filter((id) => nodeIds.has(id)) }))
            .filter((g) => g.nodeIds.length > 0);
        return {
            nodes: parsed.nodes,
            edges: cleanEdges,
            groups: cleanGroups,
            metadata: {
                ...(ir.metadata ?? {}),
                ...(parsed.metadata ?? {}),
                sourceFormat: 'unknown',
                audience,
                generatedAt: new Date().toISOString(),
            },
        } as DiagramIR;
    } catch (err) {
        console.error('[geminiService.runCritiqueAndRefine] refine pass failed', err);
        return null;
    }
}

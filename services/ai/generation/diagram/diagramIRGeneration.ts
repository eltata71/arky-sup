/**
 * Diagram IR generation: the direct call, the corrective retry, and the
 * self-healing wrapper that falls back to a deterministic skeleton. Moved out
 * of the engine in F5-01 (corte 6); prompts, schemas and budgets unchanged.
 */
import type { Settings } from '../../../../types';
import type { Artifact } from '../../../../lib/artifacts';
import type { DiagramAudience, DiagramFailureReason, DiagramIR } from '../../../../lib/diagram';
import type { Project } from '../../../architectureProjects';
import { resolveModelForSettings } from '../../catalog';
import {
    buildCorrectiveDiagramPrompt,
    buildDiagramIRSchema,
    buildDialectInstruction,
    buildIRDirectGenerationPrompt,
    buildSkeletonIRFromArtifact,
} from '../../prompts/diagramPrompts';
import { legacyTransport } from '../legacyTransport';
import { buildDiagramGenerationConfig, diagramTemperature } from './diagramGenerationConfig';
import { readModelDiagramIR } from './modelDiagramIR';

export async function generateDiagramIR(
    artifact: Artifact,
    project: Project,
    settings: Settings,
    opts: {
        audience?: DiagramAudience;
        previousIR?: DiagramIR;
        brief?: string;
        onDecline?: (reason: string) => void;
        /** What the reader removed from the answer, one line each (6.4). */
        onDropped?: (dropped: string[]) => void;
    } = {},
): Promise<DiagramIR | null> {
    const audience: DiagramAudience = opts.audience ?? artifact.audience ?? 'technical';
    const dialect = buildDialectInstruction(artifact.type);
    const responseSchema = buildDiagramIRSchema();

    const config = buildDiagramGenerationConfig({
        temperature: diagramTemperature(settings.aiConfig?.temperature),
        thinking: 'medium',
        responseSchema,
        extraSystemInstruction: dialect || undefined,
    });

    const prompt = buildIRDirectGenerationPrompt({
        artifact,
        project,
        audience,
        settings,
        previousIR: opts.previousIR,
        brief: opts.brief,
    });

    const modelName = resolveModelForSettings('default', settings).id;

    try {
        const text = await legacyTransport.generateTextWithFallback(settings, modelName, prompt, config);
        const read = readModelDiagramIR(text);
        if (read.declined !== undefined) {
            // The model said the input is not enough. That is an answer, not a
            // malformed response: it is handed up instead of retried (6.3).
            opts.onDecline?.(read.declined);
            return null;
        }
        if (read.dropped.length) opts.onDropped?.(read.dropped);
        if (!read.ir) return null;
        return {
            ...read.ir,
            metadata: {
                sourceFormat: 'unknown',
                audience,
                generatedAt: new Date().toISOString(),
                ...(read.ir.metadata ?? {}),
            },
        };
    } catch (err) {
        console.error('[geminiService.generateDiagramIR] failed', err);
        return null;
    }
}

/**
 * Self-healing variant of {@link generateDiagramIR}. Runs up to three
 * attempts:
 *   1. Standard `generateDiagramIR` with full project-context cap.
 *   2. Corrective prompt (smaller context, explicit failure reason)
 *      when the first attempt returns null / empty / malformed IR.
 *   3. Deterministic skeleton derived from `artifact.keyConcepts` so the
 *      canvas never appears empty.
 *
 * Returns the IR plus a small diagnostics record (attempts, fallback
 * status, reason) so callers can surface a precise message to the user
 * and persist `lastDiagramError` on the artifact.
 */
export async function generateDiagramIRWithSelfHealing(
    artifact: Artifact,
    project: Project,
    settings: Settings,
    opts: { audience?: DiagramAudience; previousIR?: DiagramIR; skipCorrective?: boolean; brief?: string } = {},
): Promise<{
    ir: DiagramIR;
    attempts: number;
    fallback: 'none' | 'skeleton';
    warnings: string[];
    lastReason?: DiagramFailureReason;
    /** What the model said was missing, when it declined instead of answering (6.3). */
    declineReason?: string;
    /** What the reader removed from the answer that was kept (6.4). */
    dropped: string[];
}> {
    const audience: DiagramAudience = opts.audience ?? artifact.audience ?? 'technical';
    const warnings: string[] = [];
    let dropped: string[] = [];
    const onDropped = (lines: string[]) => { dropped = lines; };

    if (!opts.skipCorrective) {
        let declineReason: string | undefined;
        const first = await generateDiagramIR(artifact, project, settings, {
            audience, previousIR: opts.previousIR, brief: opts.brief, onDecline: (reason) => { declineReason = reason; }, onDropped,
        });
        if (first && first.nodes.length > 0) {
            return { ir: first, attempts: 1, fallback: 'none', warnings, dropped };
        }
        // A model that declined for lack of information would decline again
        // with less: asking twice spends a call to learn nothing (6.3).
        if (declineReason) {
            warnings.push(`[diagram-retry] the model declined: ${declineReason}`);
            return {
                ir: buildSkeletonIRFromArtifact(artifact, project),
                attempts: 1,
                fallback: 'skeleton',
                warnings,
                lastReason: 'skeleton-fallback',
                declineReason,
                dropped: [],
            };
        }
        warnings.push('[diagram-retry] attempt 1 failed (empty or null IR)');
        console.warn('[diagram-retry] attempt 1 failed', {
            artifactId: artifact.id,
            type: artifact.type,
            reason: first ? 'empty-ir' : 'no-mermaid',
        });
    }

    // Attempt 2: corrective retry.
    const lastFailureReason = opts.skipCorrective
        ? (artifact.lastDiagramError?.reason ?? 'empty-ir')
        : 'empty-ir';
    const correctiveIR = await generateDiagramIRCorrective(artifact, project, settings, audience, lastFailureReason, opts.brief, onDropped);
    if (correctiveIR && correctiveIR.nodes.length > 0) {
        warnings.push('[diagram-retry] attempt 2 (corrective) succeeded');
        return { ir: correctiveIR, attempts: opts.skipCorrective ? 1 : 2, fallback: 'none', warnings, lastReason: lastFailureReason, dropped };
    }
    warnings.push('[diagram-retry] attempt 2 (corrective) failed; falling back to deterministic skeleton');
    console.warn('[diagram-retry] attempt 2 (corrective) failed', { artifactId: artifact.id, type: artifact.type });

    // Attempt 3: deterministic skeleton.
    const skeleton = buildSkeletonIRFromArtifact(artifact, project);
    return {
        ir: skeleton,
        attempts: opts.skipCorrective ? 2 : 3,
        fallback: 'skeleton',
        warnings,
        lastReason: 'skeleton-fallback',
        dropped: [],
    };
}

/**
 * Internal: run the corrective prompt that tells the model exactly what
 * went wrong on the previous attempt and asks for a slimmer payload.
 */
async function generateDiagramIRCorrective(
    artifact: Artifact,
    project: Project,
    settings: Settings,
    audience: DiagramAudience,
    lastFailureReason: DiagramFailureReason,
    brief?: string,
    onDropped?: (dropped: string[]) => void,
): Promise<DiagramIR | null> {
    const dialect = buildDialectInstruction(artifact.type);
    const responseSchema = buildDiagramIRSchema();
    const config = buildDiagramGenerationConfig({
        temperature: diagramTemperature(settings.aiConfig?.temperature),
        thinking: 'low',
        responseSchema,
        extraSystemInstruction: dialect || undefined,
    });
    const prompt = buildCorrectiveDiagramPrompt({
        artifact,
        project,
        audience,
        lastFailureReason,
        previousResponseSample: artifact.lastDiagramError?.sample,
        brief,
    });
    const modelName = resolveModelForSettings('default', settings).id;
    try {
        const text = await legacyTransport.generateTextWithFallback(settings, modelName, prompt, config);
        const read = readModelDiagramIR(text);
        if (read.dropped.length) onDropped?.(read.dropped);
        if (!read.ir) return null;
        return {
            ...read.ir,
            metadata: {
                sourceFormat: 'unknown',
                audience,
                generatedAt: new Date().toISOString(),
                ...(read.ir.metadata ?? {}),
            },
        };
    } catch (err) {
        console.warn('[diagram-retry] corrective attempt threw', err);
        return null;
    }
}

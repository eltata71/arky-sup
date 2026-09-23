/**
 * Diagram IR generation: the direct call, the corrective retry, and the
 * self-healing wrapper that falls back to a deterministic skeleton. Moved out
 * of the engine in F5-01 (corte 6); prompts, schemas and budgets unchanged.
 */
import type { Settings } from '../../../../types';
import type { Artifact } from '../../../../lib/artifacts';
import type { DiagramAudience, DiagramFailureReason, DiagramIR } from '../../../../lib/diagram';
import { cleanJsonString } from '../../../../utils';
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

export async function generateDiagramIR(
    artifact: Artifact,
    project: Project,
    settings: Settings,
    opts: { audience?: DiagramAudience; previousIR?: DiagramIR } = {},
): Promise<DiagramIR | null> {
    const audience: DiagramAudience = opts.audience ?? artifact.audience ?? 'technical';
    const dialect = buildDialectInstruction(artifact.type);
    const responseSchema = buildDiagramIRSchema({ withReview: true });

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
    });

    const modelName = resolveModelForSettings('default', settings).id;

    try {
        const text = await legacyTransport.generateTextWithFallback(settings, modelName, prompt, config);
        const cleanJson = cleanJsonString(text || '');
        if (!cleanJson) return null;
        const parsed = JSON.parse(cleanJson) as Partial<DiagramIR> & { error?: string };
        if (parsed.error) {
            console.warn('[geminiService.generateDiagramIR] Model declined:', parsed.error);
            return null;
        }
        if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
        if (parsed.nodes.length === 0) {
            console.warn('[geminiService.generateDiagramIR] Empty IR returned by model.');
            return null;
        }

        // Drop edges whose endpoints are not declared as nodes — this
        // prevents the "phantom edge" rendering issue where the canvas
        // shows edges into thin air after a partial structured-output
        // response.
        const nodeIds = new Set(parsed.nodes.map(n => n.id));
        const cleanEdges = parsed.edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));
        if (cleanEdges.length !== parsed.edges.length) {
            console.warn(
                '[geminiService.generateDiagramIR] Dropped edges with dangling endpoints.',
                { dropped: parsed.edges.length - cleanEdges.length },
            );
        }

        // Same defence for groups: drop nodeIds that don't exist.
        const cleanGroups = (Array.isArray(parsed.groups) ? parsed.groups : [])
            .map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => nodeIds.has(id)) }))
            .filter(g => g.nodeIds.length > 0);

        return {
            nodes: parsed.nodes,
            edges: cleanEdges,
            groups: cleanGroups,
            metadata: {
                sourceFormat: 'unknown',
                audience,
                generatedAt: new Date().toISOString(),
                ...(parsed.metadata ?? {}),
            },
        } as DiagramIR;
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
    opts: { audience?: DiagramAudience; previousIR?: DiagramIR; skipCorrective?: boolean } = {},
): Promise<{
    ir: DiagramIR;
    attempts: number;
    fallback: 'none' | 'skeleton';
    warnings: string[];
    lastReason?: DiagramFailureReason;
}> {
    const audience: DiagramAudience = opts.audience ?? artifact.audience ?? 'technical';
    const warnings: string[] = [];

    if (!opts.skipCorrective) {
        const first = await generateDiagramIR(artifact, project, settings, { audience, previousIR: opts.previousIR });
        if (first && first.nodes.length > 0) {
            return { ir: first, attempts: 1, fallback: 'none', warnings };
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
    const correctiveIR = await generateDiagramIRCorrective(artifact, project, settings, audience, lastFailureReason);
    if (correctiveIR && correctiveIR.nodes.length > 0) {
        warnings.push('[diagram-retry] attempt 2 (corrective) succeeded');
        return { ir: correctiveIR, attempts: opts.skipCorrective ? 1 : 2, fallback: 'none', warnings, lastReason: lastFailureReason };
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
): Promise<DiagramIR | null> {
    const dialect = buildDialectInstruction(artifact.type);
    const responseSchema = buildDiagramIRSchema({ withReview: false });
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
    });
    const modelName = resolveModelForSettings('default', settings).id;
    try {
        const text = await legacyTransport.generateTextWithFallback(settings, modelName, prompt, config);
        const cleanJson = cleanJsonString(text || '');
        if (!cleanJson) return null;
        const parsed = JSON.parse(cleanJson) as Partial<DiagramIR> & { error?: string };
        if (parsed.error) return null;
        if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) return null;
        const nodeIds = new Set(parsed.nodes.map((n) => n.id));
        const cleanEdges = (parsed.edges ?? []).filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
        return {
            nodes: parsed.nodes,
            edges: cleanEdges,
            groups: Array.isArray(parsed.groups) ? parsed.groups.filter((g) => g.nodeIds?.length) : [],
            metadata: {
                sourceFormat: 'unknown',
                audience,
                generatedAt: new Date().toISOString(),
                ...(parsed.metadata ?? {}),
            },
        };
    } catch (err) {
        console.warn('[diagram-retry] corrective attempt threw', err);
        return null;
    }
}

/**
 * Multi-pass diagram generation: draft → deterministic auto-repair →
 * AI critique → AI refine.  This is the highest-quality entry point and
 * what new call sites should prefer when latency budget allows.
 *
 * Stages:
 *   1. **Draft**         — `generateDiagramIR()` (existing single-shot).
 *   2. **Auto-repair**   — deterministic fixes for known violations
 *                          (generic labels, missing protocols, layer
 *                          violations, missing groups, illegal cycles).
 *                          No AI call. ~5 ms.
 *   3. **Critique**      — AI reviewer flags remaining issues using the
 *                          10-D rubric, fed with the static analyser
 *                          report and remaining architectural violations.
 *   4. **Refine**        — AI applies the critique surgically, returning
 *                          a higher-quality IR.
 *
 * Each stage can be skipped via `opts` so callers control the latency /
 * cost / quality trade-off.  Stages 3 + 4 are skipped automatically when
 * the post-repair quality score already passes the target threshold.
 */

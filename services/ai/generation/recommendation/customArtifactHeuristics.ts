/**
 * The deterministic half of the custom-artifact recommendation: the context
 * digest sent to the model, the local recommendation used when the model is
 * not needed or not available, and the naming and confidence rules both paths
 * share. Moved verbatim out of the engine in F5-01 (corte 4).
 */
import { ARTIFACT_TEMPLATES } from '../../../../constants';
import type { ArtifactTemplate, ArtifactType, CustomArtifactRecommendation } from '../../../../types';
import type { Project } from '../../../architectureProjects';
import {
    analyzeCustomArtifactIntent,
    countTokenOverlap,
    normalizeRecommendationText,
    scoreTemplateForCustomRecommendation,
    uniqueTokens,
    type CustomRecommendationContext,
} from './customArtifactIntent';

/**
 * Recommendation tier (called from "Artefacto a solicitud").
 *
 * Trade-off: the deterministic local ranker already chose the top candidates
 * before this call. The model's job is purely to *pick one* and write a
 * short rationale + construction plan. Thinking is therefore turned OFF —
 * tests showed Flash-Lite + thinkingBudget=256 was occasionally returning
 * INVALID_ARGUMENT on the public endpoint and adding 4-8s of latency for no
 * measurable quality gain. The deterministic heuristic stays the safety net.
 *
 * Latency budget rationale: 35s gives Flash-Lite room to respond on busy
 * infra without aborting prematurely. The previous 22s threshold was
 * triggering false-positive timeouts (the screenshot showed 541ms failures
 * — those were never timeouts, but the ceiling was too low to absorb the
 * one-off slow request). Two retries amortise transient blips.
 */
export const CUSTOM_RECOMMENDATION_TIMEOUT_MS = 35000;
export const CUSTOM_RECOMMENDATION_MAX_RETRIES = 2;
export const CUSTOM_RECOMMENDATION_CONTEXT_ITEMS = 8;
export const CUSTOM_RECOMMENDATION_ARTIFACTS = 6;
export const CUSTOM_RECOMMENDATION_CATALOG_CANDIDATES = 8;
export const CUSTOM_RECOMMENDATION_MAX_OUTPUT_TOKENS = 700;
export const CUSTOM_RECOMMENDATION_OBJECTIVE_CHARS = 220;

export function expectedRepresentationForType(type: ArtifactType, proposed?: ArtifactTemplate['representation']): ArtifactTemplate['representation'] {
    if (type === 'hybrid-text-diagram') return 'hybrid';
    if (type.startsWith('mermaid') || type === 'react-flow-graph') return 'diagram';
    // All presentation types currently store their deck JSON inside
    // `Artifact.content`, so the legacy `representation` field is still
    // 'document'. The slide viewer is selected by `artifact.type` (see
    // `isPresentationArtifactType`), so this stays backwards-compatible.
    if (type === 'presentation-executive' || type === 'presentation-technical'
        || type === 'presentation-overview' || type === 'presentation-summary') return 'document';
    if (type.startsWith('sdd-')) return 'document';
    if (type === 'yaml' || type === 'markdown') return proposed ?? 'document';
    return proposed ?? 'document';
}

export function buildOnDemandArtifactName(catalogName: string, idea: string): string {
    const cleanedIdea = idea
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const withoutGenericLead = cleanedIdea
        .replace(/^(necesito|requiero|quiero|crear|generar|diagrama|modelo|documento|artefacto)\s+(un|una|el|la|de la|del|de|que|para|sobre)?\s*/i, '')
        .replace(/^(que\s+)?(ilustre|muestre|explique|represente)\s+/i, '')
        .replace(/^el\s+flujo\s+de\s+trabajo\s+(para|de|del|de la)\s+/i, '')
        .trim();
    const titleSeed = withoutGenericLead.length > 0 ? withoutGenericLead : cleanedIdea;
    const compactTitle = titleSeed.length > 58 ? `${titleSeed.slice(0, 55).trimEnd()}…` : titleSeed;
    const suffix = compactTitle || 'solicitud personalizada';
    const candidate = `${catalogName} — ${suffix}`;
    return candidate.length > 96 ? `${candidate.slice(0, 93).trimEnd()}…` : candidate;
}

export function isCatalogTemplateName(name: string): boolean {
    return ARTIFACT_TEMPLATES.some(template => template.name.toLowerCase() === name.trim().toLowerCase());
}

export function normalizeTemplateContract<T extends ArtifactTemplate>(template: T): T {
    const representation = expectedRepresentationForType(template.type, template.representation);
    return { ...template, representation };
}

export function buildCustomArtifactRecommendationContext(project: Project, idea: string): CustomRecommendationContext {
    const projectContext = project.projectContext ?? [];
    const artifacts = project.artifacts ?? [];
    const projectSignal = [
        project.name,
        project.description,
        ...projectContext,
        ...artifacts.flatMap(artifact => [
            artifact.name,
            artifact.objective,
            artifact.type,
            artifact.architecturalView,
            artifact.phase,
            artifact.content.slice(0, 800),
        ]),
    ].join('\n');
    const deterministicIntent = analyzeCustomArtifactIntent(idea);
    const ideaTokens = uniqueTokens(`${idea}\n${project.name}\n${project.description}`);

    const relevantProjectContext = projectContext
        .map((item, index) => ({ item, index, score: countTokenOverlap(item, ideaTokens) }))
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .slice(0, CUSTOM_RECOMMENDATION_CONTEXT_ITEMS)
        .map(entry => entry.item);

    const truncate = (text: string, max: number): string =>
        text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;

    const artifactInventory = artifacts
        .slice()
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
        .slice(0, CUSTOM_RECOMMENDATION_ARTIFACTS)
        .map(artifact => `${artifact.name} | ${artifact.type} | ${artifact.architecturalView} | ${truncate(artifact.objective ?? '', 120)}`);

    const catalogCandidates = ARTIFACT_TEMPLATES
        .map(template => ({
            name: template.name,
            type: template.type,
            phase: template.phase,
            architecturalView: template.architecturalView,
            representation: template.representation,
            // Truncate the objective so the JSON payload stays compact —
            // every catalog entry was sending its full 300-500 char objective
            // before, multiplying the prompt size for no ranking benefit.
            objective: truncate(template.objective ?? '', CUSTOM_RECOMMENDATION_OBJECTIVE_CHARS),
            score: scoreTemplateForCustomRecommendation(template, idea, projectSignal, deterministicIntent),
        }))
        .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
        .slice(0, CUSTOM_RECOMMENDATION_CATALOG_CANDIDATES);

    const fallbackTemplate = catalogCandidates[0]?.name
        ?? ARTIFACT_TEMPLATES.find(template => template.name === 'Resumen de Arquitectura')?.name
        ?? ARTIFACT_TEMPLATES[0]?.name
        ?? '';

    return {
        projectBrief: {
            name: project.name,
            description: project.description,
            totalContextItems: projectContext.length,
            totalArtifacts: artifacts.length,
        },
        relevantProjectContext,
        artifactInventory,
        catalogCandidates,
        heuristicTemplateName: fallbackTemplate,
        deterministicIntent,
    };
}

export function buildHeuristicCustomArtifactRecommendation(project: Project, idea: string): CustomArtifactRecommendation {
    const context = buildCustomArtifactRecommendationContext(project, idea);
    const selected = ARTIFACT_TEMPLATES.find(template => template.name === context.heuristicTemplateName)
        ?? ARTIFACT_TEMPLATES.find(template => template.name === 'Resumen de Arquitectura')
        ?? ARTIFACT_TEMPLATES[0];
    const ideaPreview = idea.length > 96 ? `${idea.slice(0, 93).trimEnd()}…` : idea;
    const projectContextNote = context.projectBrief.totalContextItems > 0
        ? `Se priorizaron ${context.relevantProjectContext.length} señales relevantes de ${context.projectBrief.totalContextItems} elementos de contexto del proyecto.`
        : 'El proyecto no tiene contexto adicional registrado; se usaron nombre, descripción e inventario de artefactos.';

    const audience: CustomArtifactRecommendation['audience'] = /\b(comite|gerencia|directivo|ejecutivo|decision|aprobar)\b/.test(normalizeRecommendationText(idea)) ? 'executive' : 'mixed';
    const rationale = `Recomendación local de respaldo: el patrón de intención de la solicitud y el contexto completo del proyecto apuntan a “${selected.name}”. ${projectContextNote}`;
    const constructionPlan = [
        'Usar el nombre, descripción, contexto acumulado e inventario de artefactos del proyecto como insumo de generación.',
        `Estructurar el contenido con el estándar “${selected.name}” para mantener compatibilidad con el catálogo actual.`,
        'Generar el artefacto editable y trazable dentro del canvas del proyecto.',
    ];

    return {
        template: normalizeTemplateContract({
            ...selected,
            name: buildOnDemandArtifactName(selected.name, idea),
            objective: `${selected.objective} En esta solicitud, debe comunicar: ${ideaPreview}`,
            requestContext: {
                userRequest: idea,
                rationale,
                constructionPlan,
                matchedCatalogTemplateName: selected.name,
                audience,
            },
        }),
        matchedCatalogTemplateName: selected.name,
        rationale,
        constructionPlan,
        audience,
        confidence: Math.max(0.62, Math.min(0.86, (context.catalogCandidates[0]?.score ?? 20) / 80)),
    };
}

/**
 * Calibrated confidence score for a custom-artifact recommendation.
 *
 * Combines:
 *  - The absolute score of the top candidate (saturating around 80).
 *  - The relative gap to the second candidate (rewards a clear winner).
 *  - A floor so the UI never shows uselessly low percentages when the
 *    deterministic ranking did succeed in finding a valid match.
 *
 * Returns a value in [0.55, 0.97] so the UI percentage stays meaningful and
 * doesn't oscillate between 0% and 100% on tiny score differences.
 */
export function calibrateRecommendationConfidence(
    topScore: number,
    runnerUpScore: number,
    fallbackFloor = 0.6,
): number {
    if (!Number.isFinite(topScore) || topScore <= 0) return fallbackFloor;
    const absolute = Math.min(topScore / 80, 1); // saturates at 80 (clear win).
    const safeRunner = Math.max(0, runnerUpScore);
    const gap = (topScore - safeRunner) / Math.max(topScore, 12);
    const blended = absolute * 0.65 + Math.min(Math.max(gap, 0), 1) * 0.35;
    return Math.max(0.55, Math.min(0.97, Number(blended.toFixed(2))));
}

/**
 * Returns a unique on-demand artifact name within the project, appending a
 * version suffix when a previous on-demand artifact already used the same
 * candidate name. Prevents the "two artifacts with identical title" UX bug.
 */
export function deduplicateOnDemandArtifactName(
    candidate: string,
    existingArtifactNames: ReadonlyArray<string>,
): string {
    const taken = new Set(existingArtifactNames.map(name => name.trim().toLowerCase()));
    if (!taken.has(candidate.trim().toLowerCase())) return candidate;
    for (let v = 2; v < 50; v += 1) {
        const next = candidate.length > 90
            ? `${candidate.slice(0, 87).trimEnd()}… (v${v})`
            : `${candidate} (v${v})`;
        if (!taken.has(next.trim().toLowerCase())) return next;
    }
    return `${candidate} (${Date.now().toString(36)})`;
}

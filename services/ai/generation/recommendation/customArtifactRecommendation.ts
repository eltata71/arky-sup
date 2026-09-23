/**
 * "Artefacto a solicitud": recommend the catalogue artifact that best
 * communicates a free-text idea, from the project's own context.
 *
 * Left the engine in F5-01 (corte 4). The local ranker decides first and the
 * model is only asked when the ranking is close; any model failure degrades to
 * the deterministic recommendation, never to an error.
 */
import type { CustomArtifactRecommendation, Settings } from '../../../../types';
import { emitGenerationPhase, type ArtifactGenerationPhaseEvent, type ArtifactGenerationPhaseListener } from '../../../../lib/artifacts';
import type { Project } from '../../../architectureProjects';
import { resolveModelForSettings } from '../../catalog';
import { AIServiceError, classifyAIError } from '../../errors';
import { isParseAiJsonFailure, parseAiJson } from '../../parseAiJson';
import { buildBasePrompt } from '../../prompts/projectPrompts';
import { aiGateway } from '../aiGateway';
import {
    buildCustomArtifactRecommendationContext,
    buildHeuristicCustomArtifactRecommendation,
    CUSTOM_RECOMMENDATION_MAX_OUTPUT_TOKENS,
    CUSTOM_RECOMMENDATION_MAX_RETRIES,
    CUSTOM_RECOMMENDATION_TIMEOUT_MS,
    deduplicateOnDemandArtifactName,
} from './customArtifactHeuristics';
import { normalizeCustomArtifactRecommendation } from './customArtifactNormalization';

export async function recommendCustomArtifactTemplate(
    project: Project,
    idea: string,
    settings: Settings,
    opts: { onPhase?: ArtifactGenerationPhaseListener } = {}
): Promise<CustomArtifactRecommendation> {
    const { onPhase } = opts;
    const stageTimings = new Map<string, number>();
    const emit = (event: Omit<ArtifactGenerationPhaseEvent, 'at'>) =>
        emitGenerationPhase(onPhase, event, stageTimings);

    const trimmedIdea = idea.trim();
    if (trimmedIdea.length < 20) {
        emit({
            stage: 'recommendation',
            status: 'error',
            message: 'La idea es demasiado corta para recomendar un artefacto.',
            detail: 'Mínimo 20 caracteres requeridos.',
        });
        throw new Error('Describe la idea con al menos 20 caracteres para poder recomendar un artefacto.');
    }

    emit({
        stage: 'recommendation',
        status: 'in-progress',
        message: 'Tokenizando intención y ranqueando catálogo localmente.',
        meta: { ideaLength: trimmedIdea.length, projectArtifacts: project.artifacts?.length ?? 0 },
    });

    const recommendationContext = buildCustomArtifactRecommendationContext(project, trimmedIdea);
    const existingNames = (project.artifacts ?? []).map(a => a.name);
    const fallbackRecommendation = (() => {
        const base = buildHeuristicCustomArtifactRecommendation(project, trimmedIdea);
        const dedupedName = deduplicateOnDemandArtifactName(base.template.name, existingNames);
        return {
            ...base,
            template: { ...base.template, name: dedupedName },
        };
    })();

    emit({
        stage: 'recommendation',
        status: 'success',
        message: `Detectada intención principal "${recommendationContext.deterministicIntent.primaryIntent}" sobre ${recommendationContext.catalogCandidates.length} candidatos del catálogo.`,
        detail: `Top candidato local: ${recommendationContext.catalogCandidates[0]?.name ?? 'n/d'}.`,
        meta: {
            primaryIntent: recommendationContext.deterministicIntent.primaryIntent,
            topScore: recommendationContext.catalogCandidates[0]?.score ?? 0,
            runnerUpScore: recommendationContext.catalogCandidates[1]?.score ?? 0,
        },
    });

    // ── HIGH-CONFIDENCE LOCAL BYPASS ──────────────────────────────────────
    //
    // When the deterministic ranker has a clear winner (high absolute score
    // AND large gap to the runner-up), we skip the Gemini call entirely.
    // This:
    //  1. Eliminates the 3-4s recommendation latency the user has been
    //     experiencing on every request.
    //  2. Removes a large class of failure modes (Flash-Lite saturation,
    //     INVALID_ARGUMENT on responseSchema, network blips on iOS Safari).
    //  3. Costs us nothing in quality: when the gap is large the local
    //     ranker is already correct — Gemini was just rubber-stamping.
    //
    // Threshold rationale: top score ≥ 40 AND (top - runner-up) ≥ 12 means
    // the keyword/intent overlap is strong enough that a runner-up flip is
    // essentially impossible. If a request is ambiguous (close scores), we
    // still call Gemini for a tiebreaker.
    const topCandidate = recommendationContext.catalogCandidates[0];
    const runnerUp = recommendationContext.catalogCandidates[1];
    const topScore = topCandidate?.score ?? 0;
    const runnerScore = runnerUp?.score ?? 0;
    const scoreGap = topScore - runnerScore;
    const hasHighConfidenceLocalMatch = topScore >= 40 && scoreGap >= 12;
    if (hasHighConfidenceLocalMatch) {
        emit({
            stage: 'recommendation',
            status: 'success',
            message: 'Ranker local con alta confianza; se omite la llamada a Gemini para ofrecer respuesta inmediata.',
            detail: `topScore=${topScore} runnerUp=${runnerScore} gap=${scoreGap} → suficientemente claro para no necesitar tiebreaker IA.`,
            meta: { topScore, runnerScore, scoreGap, bypass: 'local-high-confidence' },
        });
        return fallbackRecommendation;
    }

    // Compact, single-line JSON to minimise token count. Pretty-printed
    // JSON was inflating the prompt by ~30% with no semantic gain, and
    // every saved token both lowers cost and shortens latency on Flash-Lite.
    const compactDigest = JSON.stringify(recommendationContext);

    const prompt = `${buildBasePrompt(project, settings, { mode: 'diagram', maxContextItems: 0, maxDescriptionChars: 600 })}

You are an expert solution architect. Recommend the best Arky architecture artifact for the user's request.

USER IDEA TO COMMUNICATE:
"""
${trimmedIdea}
"""

PROJECT CONTEXT DIGEST (deterministically pre-ranked):
${compactDigest}

CATALOG POLICY:
- catalogCandidates was scored locally against full project context. Prefer candidate #1 unless intent clearly requires another listed candidate.
- Use deterministicIntent as ranking evidence, not as prose to repeat.
- Use only supported output types listed in catalogCandidates.
- Honor explicit format constraints from the user: if they ask for a documento, informe, tabla, matriz or listado, choose a document representation unless they also explicitly ask for a diagram.
- For gaps, pending functional/non-functional requirements, coverage or traceability requests, prefer SRS / Requirements Traceability Matrix / NFR document artifacts over data-flow diagrams.
- For workflow/process requests prefer a hybrid process artifact (BPMN-style) over a generic text document.

Return ONLY valid JSON with this structure:
{
  "matchedCatalogTemplateName": "existing catalog name or empty string",
  "name": "artifact title to create",
  "type": "one supported type",
  "phase": "one catalog phase",
  "architecturalView": "one catalog architecturalView",
  "representation": "diagram|document|hybrid",
  "objective": "specific objective based on the user idea and project context",
  "keyConcepts": [{"term":"...","definition":"..."}],
  "rationale": "why this artifact best communicates the idea using project context",
  "constructionPlan": ["step 1", "step 2", "step 3"],
  "audience": "technical|executive|mixed",
  "confidence": 0.0
}`;

    try {
        const resolvedModel = resolveModelForSettings('quick', settings);
        const modelName = resolvedModel.id;
        emit({
            stage: 'recommendation',
            status: 'in-progress',
            message: `Consultando a Gemini (${modelName}) con esquema estructurado.`,
            detail: `Timeout ${CUSTOM_RECOMMENDATION_TIMEOUT_MS}ms · reintentos ${CUSTOM_RECOMMENDATION_MAX_RETRIES} · thinking=default (Flash-Lite OFF) · si el schema es rechazado se reintenta sin schema. Fuente del modelo: ${resolvedModel.source}${resolvedModel.requested ? ` (preferencia: ${resolvedModel.requested})` : ''}.`,
            meta: {
                model: modelName,
                modelSource: resolvedModel.source,
                modelRequested: resolvedModel.requested ?? '',
                tier: resolvedModel.tier,
                timeoutMs: CUSTOM_RECOMMENDATION_TIMEOUT_MS,
                maxRetries: CUSTOM_RECOMMENDATION_MAX_RETRIES,
            },
        });
        // Minimal config — passing only the fields the public Flash-Lite
        // endpoint reliably accepts. The previous version included an
        // explicit `thinkingConfig: { thinkingBudget: 0 }` and a deeply-
        // nested responseSchema which combined to produce the consistent
        // "unknown" error category seen post-deploy. Flash-Lite has
        // thinking OFF by default, so omitting `thinkingConfig` removes
        // a field the validator was apparently rejecting on certain
        // accounts/regions.
        const callRecommender = async (useSchema: boolean): Promise<string> => {
            const baseConfig: Record<string, unknown> = {
                temperature: Math.min(settings.aiConfig?.temperature ?? 0.7, 0.25),
                topP: 0.9,
                maxOutputTokens: CUSTOM_RECOMMENDATION_MAX_OUTPUT_TOKENS,
            };
            if (useSchema) {
                baseConfig.responseMimeType = 'application/json';
                baseConfig.responseSchema = {
                    type: 'object',
                    properties: {
                        matchedCatalogTemplateName: { type: 'string' },
                        name: { type: 'string' },
                        type: { type: 'string' },
                        phase: { type: 'string' },
                        architecturalView: { type: 'string' },
                        representation: { type: 'string' },
                        objective: { type: 'string' },
                        keyConcepts: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    term: { type: 'string' },
                                    definition: { type: 'string' },
                                },
                                required: ['term', 'definition'],
                            },
                        },
                        rationale: { type: 'string' },
                        constructionPlan: { type: 'array', items: { type: 'string' } },
                        audience: { type: 'string' },
                        confidence: { type: 'number' },
                    },
                    required: [
                        'matchedCatalogTemplateName', 'name', 'type', 'phase', 'architecturalView',
                        'representation', 'objective', 'keyConcepts', 'rationale', 'constructionPlan',
                        'audience', 'confidence',
                    ],
                };
            }

            // Through the gateway, not the SDK: this call used to build its own
            // Gemini client, which skipped the proxy (so a production build with
            // server-side keys never reached a model here), the input guardrail
            // and the provider routing. One model, as before — the deterministic
            // recommendation is the fallback, not a second model.
            const { text } = await aiGateway.generateContent(settings, modelName, prompt, baseConfig, {
                timeoutMs: CUSTOM_RECOMMENDATION_TIMEOUT_MS,
                maxRetries: CUSTOM_RECOMMENDATION_MAX_RETRIES,
                maxCandidates: 1,
            });
            return text || '';
        };

        let responseText: string;
        try {
            responseText = await callRecommender(true);
        } catch (schemaError) {
            // If the failure looks like a schema/argument validation error
            // (status 400 INVALID_ARGUMENT), retry once WITHOUT the
            // structured schema — the prompt itself instructs the model to
            // emit valid JSON, and `cleanJsonString` extracts it. This
            // converts a hard fail into a degraded-but-working response.
            const friendly = classifyAIError(schemaError);
            if (friendly.category === 'invalid-request') {
                console.warn('[customArtifactRecommendation] Recommendation responseSchema rejected; retrying without schema.', friendly.message);
                emit({
                    stage: 'recommendation',
                    status: 'in-progress',
                    message: 'Esquema estricto rechazado; reintentando sin schema (parser local validará la salida).',
                    meta: { rawMessage: friendly.message?.toString().slice(0, 200) ?? '' },
                });
                responseText = await callRecommender(false);
            } else {
                throw schemaError;
            }
        }

        // Tolerant parse: if the model truncated the response (most often
        // a `JSON Parse error: Expected ']'` when Flash-Lite hits the
        // output cap mid-array), `parseAiJson` repairs the response when
        // safe and reports which repairs ran via `repairedFrom`. Only on
        // a fully unrecoverable response do we throw, which then routes
        // to the deterministic local fallback below.
        const parseResult = parseAiJson<Record<string, unknown>>(responseText, { emptyAs: 'object' });
        if (isParseAiJsonFailure(parseResult)) {
            const failureError = parseResult.error;
            const failureAttemptedLength = parseResult.attempted.length;
            emit({
                stage: 'recommendation',
                status: 'warning',
                message: 'No se pudo reparar la respuesta JSON del modelo; se usará la ruta determinística local.',
                detail: `Detalle del parser: ${failureError.slice(0, 220)}`,
                meta: { parseError: failureError.slice(0, 240), attemptedLength: failureAttemptedLength },
            });
            throw new AIServiceError(
                'malformed-response',
                undefined,
                failureError,
                'El modelo devolvió una respuesta que no fue posible reparar; se usará la ruta local determinística.',
                true,
            );
        }
        if (parseResult.repairedFrom.length > 0) {
            emit({
                stage: 'recommendation',
                status: 'warning',
                message: 'La respuesta del modelo requirió reparaciones automáticas para ser parseable.',
                detail: `Reparaciones aplicadas: ${parseResult.repairedFrom.join(', ')}.`,
                meta: { repairs: parseResult.repairedFrom.join(',') },
            });
        }
        const parsed = parseResult.data;
        const normalized = normalizeCustomArtifactRecommendation(parsed, trimmedIdea, recommendationContext);
        // De-duplicate against existing artifact names so two on-demand
        // requests never collide on a single project.
        const dedupedName = deduplicateOnDemandArtifactName(normalized.template.name, existingNames);
        const finalRecommendation: CustomArtifactRecommendation = {
            ...normalized,
            template: { ...normalized.template, name: dedupedName },
        };
        emit({
            stage: 'recommendation',
            status: 'success',
            message: `Recomendación validada: ${finalRecommendation.template.name} (${Math.round(finalRecommendation.confidence * 100)}% confianza).`,
            detail: `Tipo ${finalRecommendation.template.type} · vista ${finalRecommendation.template.architecturalView} · audiencia ${finalRecommendation.audience}.`,
            meta: {
                confidence: Number(finalRecommendation.confidence.toFixed(2)),
                type: finalRecommendation.template.type,
                audience: finalRecommendation.audience,
                matchedCatalog: finalRecommendation.matchedCatalogTemplateName ?? '',
            },
        });
        return finalRecommendation;
    } catch (error) {
        const friendly = classifyAIError(error);
        console.warn(
            `[customArtifactRecommendation] Custom artifact recommendation used local fallback (${friendly.category}).`,
            friendly.message,
        );
        const phaseMessage = friendly.category === 'timeout'
            ? 'Gemini tardó demasiado en responder; usando recomendación local determinista.'
            : friendly.category === 'network'
                ? 'Conexión con Gemini interrumpida; usando recomendación local determinista.'
                : friendly.category === 'overloaded' || friendly.category === 'rate-limit'
                    ? 'Gemini está saturado; usando recomendación local determinista. La calidad se preserva con el ranker heurístico.'
                    : `Gemini devolvió un error (${friendly.category}); usando recomendación local determinista.`;
        // Surface the underlying SDK message so observability shows the
        // real cause (e.g. INVALID_ARGUMENT details, server status text)
        // — without it the user sees a generic "unknown" with no actionable
        // diagnostic. Trim hard to avoid blowing up the UI panel.
        const rawMessage = friendly.message?.toString().slice(0, 320) ?? '';
        emit({
            stage: 'recommendation',
            status: 'warning',
            message: phaseMessage,
            detail: rawMessage
                ? `${friendly.userMessage} · Detalle del SDK: ${rawMessage}`
                : friendly.userMessage,
            meta: {
                errorCategory: friendly.category,
                status: friendly.status ?? 0,
                rawMessage,
            },
        });
        return fallbackRecommendation;
    }
}

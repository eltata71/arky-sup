/**
 * El transporte de la fachada legacy, fuera del motor (F5-01, primer corte).
 *
 * `services/geminiService.ts` hacía dos trabajos en una clase: **componer
 * prompts de dominio** —artefactos, diagramas, asistente— y **llevarlos a un
 * proveedor** con el proxy, los reintentos, el tope de tiempo y el cambio de
 * modelo. El segundo trabajo es de esta capa, y tenerlo dentro del motor
 * obligaba a toda fachada que sólo quería enviar un prompt propio
 * (`aiGateway`, captura asistida, guía de la plataforma, asistente de
 * iniciativas, edición de diagramas) a importar el motor entero. Esa
 * importación es la arista `services/ai -> services (raíz)` que cierra el
 * componente de nueve contextos (F5-01, ADR-104).
 *
 * El código se movió tal cual y el motor lo usa por delegación: mismo
 * comportamiento, y ahora se puede usar sin arrastrar el motor.
 *
 * El cliente de Gemini se **inyecta** (`getClient`): el motor pasa el suyo,
 * así que lo que las pruebas doblan sobre `geminiService.getAIClient` sigue
 * doblando lo mismo.
 */

import type { Settings } from '../../../types';
import { createGeminiAIClient } from '../providers/gemini/geminiClient';
import { MODEL_FALLBACK_CHAIN } from '../../../lib/ai/modelCatalog';
import { proxyProviderFor } from '../catalog';
import { toGeminiTools, type AIToolDefinition } from '../tools';
import { toGeminiSchema } from '../schema';
import { aiRequestExecutor } from '../core/AIRequestExecutor';
import { callAiProxyDetailed, isAiProxyConfigured, streamAiProxyDetailed } from '../aiProxyClient';
import { isProxySuccess } from '../aiProxyPolicy';
import { assertDirectCallAllowed, assertDirectCallAllowedFor } from '../aiProxyEnforcement';
import { AIRetryPolicy } from '../retry/AIRetryPolicy';
import { AIServiceError, classifyAIError, isTransientGeminiError } from '../errors';
import { buildCanonicalRequest, routeLegacyRequest, withGeminiHealth } from './legacyGeminiBridge';

/** El cliente de Gemini tal como lo construye su adaptador. */
export type GeminiClient = ReturnType<typeof createGeminiAIClient>;

/** El `contents` que acepta el SDK; los llamantes escriben la unión legacy. */
type GeminiContents = Parameters<GeminiClient['models']['generateContent']>[0]['contents'];

/** El `config` con forma de Gemini que escriben todavía las llamadas legacy. */
export type LegacyGenerationConfig = Record<string, unknown>;

// Configuración del bucle de generación (antes, constantes del motor).
export const GENERATION_TIMEOUT_MS = 90000;
// Generation now retries up to 2 times on transient network errors. Previously
// this was 0, which meant a single mobile-Safari "Load failed" or 503 burst
// would surface as a hard error in the UI even though Gemini almost always
// recovers within a couple of seconds.
export const GENERATION_MAX_RETRIES = 2;
export const INITIAL_BACKOFF_MS = 1200;
export const MAX_BACKOFF_MS = 16000;

/** Las opciones de una llamada: tope de tiempo, candidatos, reintentos y cancelación. */
export interface LegacyGenerationOptions {
    timeoutMs?: number;
    maxCandidates?: number;
    maxRetries?: number;
    signal?: AbortSignal;
}

/** Lo que devuelve una generación completa. */
export interface LegacyGenerationResult {
    text: string;
    functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }>;
}

/**
 * Normalise a Gemini `config` at the SDK boundary: schemas written in the
 * neutral `AIJsonSchema` dialect and canonical tools are translated here, so a
 * call site works whichever dialect it was written in. `toGeminiSchema` is
 * idempotent, so this is safe to apply unconditionally.
 */
export const atGeminiBoundary = <T extends object>(config: T): T => {
    if (!config) return config;
    // Se lee como registro y se devuelve con el tipo del llamante: el SDK recibe
    // su propio `config`, sólo que con el esquema y las herramientas traducidos.
    const record = config as Record<string, unknown>;
    let out: Record<string, unknown> = record;
    if (record.responseSchema !== undefined && record.responseSchema !== null) {
        out = { ...out, responseSchema: toGeminiSchema(record.responseSchema as Parameters<typeof toGeminiSchema>[0]) };
    }
    // Tools are declared canonically and translated here, like schemas.
    if (Array.isArray(record.tools) && record.tools.length > 0) {
        out = { ...out, tools: toGeminiTools(record.tools as AIToolDefinition[]) };
    }
    return out as T;
};


/** La clave del usuario, o un error que dice dónde ponerla. La global nunca viaja al navegador. */
export const effectiveGeminiApiKey = (settings?: Settings): string => {
    const apiKeySource = settings?.aiConfig?.apiKeySource || 'global';
    const userKey = typeof localStorage !== 'undefined' ? localStorage.getItem('user_gemini_key') : null;

    if (apiKeySource === 'user' && userKey && userKey.trim().length > 0) {
        return userKey.trim();
    }

    throw new Error("No se encontró una API Key personal válida. Para una llamada directa, ve a Configuración > IA y agrega tu llave personal.");
};

export interface LegacyTransportDependencies {
    /** Cómo obtener un cliente de Gemini para estos ajustes. */
    readonly getClient?: (settings: Settings) => GeminiClient;
}

export class LegacyGenerationTransport {
    private readonly getClient: (settings: Settings) => GeminiClient;

    constructor(dependencies: LegacyTransportDependencies = {}) {
        this.getClient = dependencies.getClient
            ?? ((settings) => createGeminiAIClient({ apiKey: effectiveGeminiApiKey(settings) }));
    }

    /** El cliente de Gemini de esta llamada: la costura que las pruebas sustituyen. */
    public getAIClient(settings: Settings): GeminiClient {
        return this.getClient(settings);
    }

    /**
     * Canonical retry/timeout/model-fallback loop shared by every text
     * generation entry point (artifact-gen, chat, guided-creation, training).
     *
     * Why this is the standard:
     *  - Each Gemini model has its own per-key quota pool. If `gemini-2.5-pro`
     *    returns 429, `gemini-2.5-flash` usually still has budget; we MUST
     *    try the next model before surfacing an error.
     *  - Transient 5xx/network errors retry inside one model through the
     *    executor's `AIRetryPolicy`; rate-limit/overload after retries fall
     *    through to the next model via {@link isModelFallbackCandidate}.
     *  - Aborts propagate so iOS Safari doesn't leak sockets.
     */
    public async runWithModelFallback<T>(
        settings: Settings,
        preferredModel: string,
        runOne: (modelId: string, ai: GeminiClient, signal: AbortSignal) => Promise<T>,
        options: { timeoutMs?: number; maxCandidates?: number; maxRetries?: number; signal?: AbortSignal } = {}
    ): Promise<T> {
        // The loop itself is `AIRequestExecutor`'s; this injects the SDK call
        // (`runOne`) and the Gemini-specific error predicates.
        const retryPolicy = new AIRetryPolicy({
            maxRetries: options.maxRetries ?? GENERATION_MAX_RETRIES,
            initialBackoffMs: INITIAL_BACKOFF_MS,
            maxBackoffMs: MAX_BACKOFF_MS,
        });
        return aiRequestExecutor.runWithModelFallback<T>({
            preferredModel,
            fallbackChain: MODEL_FALLBACK_CHAIN,
            attempt: (modelId, signal) =>
                // Health is recorded on this path too, not only on the canonical
                // one. Gemini serves most traffic in this build, so a circuit
                // that only ever saw the other two backends would report the
                // portfolio as healthy through an outage of the one in use.
                withGeminiHealth(() => runOne(modelId, this.getAIClient(settings), signal)),
            retryPolicy,
            timeoutMs: options.timeoutMs ?? GENERATION_TIMEOUT_MS,
            shouldRetry: (error) =>
                isTransientGeminiError(error) && classifyAIError(error).category !== 'rate-limit',
            normalizeError: (error) => classifyAIError(error),
            isModelFallbackCandidate: (error) => this.isModelFallbackCandidate(error),
            maxCandidates: options.maxCandidates,
            signal: options.signal,
            timeoutMessage: 'Generation timed out.',
            onModelSelected: (modelId, index) => {
                if (index > 0) {
                    console.warn(`GeminiService: Trying fallback model "${modelId}"...`);
                }
            },
        });
    }

    /**
     * Route a generation through the serverless proxy (`api/ai.ts`) when
     * `VITE_AI_PROXY_URL` is configured, so the global API key never ships in
     * the browser bundle.
     *
     * Returns `null` — meaning "caller should use the direct provider path" —
     * when the proxy is not configured, when the request needs SDK features the
     * proxy's text contract can't carry (tools/function calling), or when the
     * proxy call fails. The direct path keeps its own retry + model-fallback
     * pipeline, so a proxy outage degrades instead of breaking.
     */
    private async tryAiProxy(
        settings: Settings,
        preferredModel: string,
        contents: unknown,
        config: LegacyGenerationConfig,
        options: { signal?: AbortSignal }
    ): Promise<string | null> {
        if (!isAiProxyConfigured()) {
            assertDirectCallAllowedFor(settings, 'not-configured');
            return null;
        }
        // Tool calling and providers the proxy cannot route have no proxied
        // form at all. Under enforcement that is a refusal, not a silent
        // downgrade: `assertDirectCallAllowedFor` throws, and with enforcement
        // off it returns and the direct path runs exactly as before.
        if (config.tools || config.toolConfig) {
            assertDirectCallAllowedFor(settings, 'unsupported-request');
            return null;
        }
        const proxyProvider = proxyProviderFor(settings);
        if (!proxyProvider) {
            assertDirectCallAllowedFor(settings, 'unsupported-request');
            return null;
        }

        const outcome = await callAiProxyDetailed({
            provider: proxyProvider,
            model: preferredModel,
            contents,
            systemInstruction: typeof config.systemInstruction === 'string' ? config.systemInstruction : undefined,
            temperature: typeof config.temperature === 'number' ? config.temperature : undefined,
            maxOutputTokens: typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens : undefined,
            responseMimeType: typeof config.responseMimeType === 'string' ? config.responseMimeType : undefined,
            responseSchema: config.responseSchema,
            signal: options.signal,
        });
        if (isProxySuccess(outcome)) return outcome.value;
        assertDirectCallAllowed(settings, outcome);
        return null;
    }

    public async generateTextWithFallback(
        settings: Settings,
        preferredModel: string,
        contents: string,
        config: LegacyGenerationConfig,
        options: { timeoutMs?: number; maxCandidates?: number; maxRetries?: number; signal?: AbortSignal } = {}
    ): Promise<string> {
        // Proxy first, like the other two paths: skipping it left users without
        // a personal key with no model at all in production.
        const proxied = await this.tryAiProxy(settings, preferredModel, contents, config, options);
        if (proxied !== null) return proxied;

        const textRequest = buildCanonicalRequest(preferredModel, contents, config, options, 'generation');
        const textRoute = routeLegacyRequest(settings, textRequest);
        if (textRoute.plan.primary.provider !== 'gemini') {
            const response = await aiRequestExecutor.execute(textRoute.provider, textRequest, undefined, {
                settings,
                routePlan: textRoute.plan,
                resolveProvider: textRoute.resolveProvider,
            });
            return response.text || '';
        }
        return this.runWithModelFallback(settings, preferredModel, async (model, ai, signal) => {
            const response = await ai.models.generateContent({
                model,
                contents,
                config: atGeminiBoundary({ ...config, abortSignal: signal }),
            });
            return response.text || '';
        }, options);
    }

    /**
     * Public entry point for arbitrary text/chat generation with the full
     * model-fallback pipeline. Use this from any assistant (chat, guided
     * creation, LMS, training) instead of calling `ai.models.generateContent`
     * directly — that bypass is what caused guided-creation to surface a
     * single 429 as a hard error while artifact generation silently fell
     * back to Flash.
     */
    public async generateContentWithFallback(
        settings: Settings,
        preferredModel: string,
        contents: unknown,
        config: LegacyGenerationConfig = {},
        options: { timeoutMs?: number; maxCandidates?: number; maxRetries?: number; signal?: AbortSignal } = {}
    ): Promise<{ text: string; functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }> }> {
        // Synchronous guard: with no proxy, not even an extra microtask.
        if (isAiProxyConfigured()) {
            const proxied = await this.tryAiProxy(settings, preferredModel, contents, config, options);
            if (proxied !== null) return { text: proxied };
        } else {
            assertDirectCallAllowedFor(settings, 'not-configured');
        }

        const contentRequest = buildCanonicalRequest(preferredModel, contents, config, options, 'generation');
        const contentRoute = routeLegacyRequest(settings, contentRequest);
        if (contentRoute.plan.primary.provider !== 'gemini') {
            const response = await aiRequestExecutor.execute(contentRoute.provider, contentRequest, undefined, {
                settings,
                routePlan: contentRoute.plan,
                resolveProvider: contentRoute.resolveProvider,
            });
            // The canonical response carries `toolCalls`; this façade's own
            // result shape still speaks `{ name, args }` because its callers
            // do. The mapping is one line and it is here, at the boundary,
            // rather than pushed into the contract as a legacy alias.
            return {
                text: response.text || '',
                functionCalls: response.toolCalls?.map((call) => ({
                    name: call.name,
                    args: call.arguments,
                })),
            };
        }
        return this.runWithModelFallback(settings, preferredModel, async (model, ai, signal) => {
            const response = await ai.models.generateContent({
                model,
                contents: contents as GeminiContents,
                config: atGeminiBoundary({ ...config, abortSignal: signal }),
            });
            const functionCalls = (response as { functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }> }).functionCalls;
            return { text: response.text || '', functionCalls };
        }, options);
    }

    /**
     * Streaming counterpart of {@link generateContentWithFallback}. Falls
     * back through {@link MODEL_FALLBACK_CHAIN} only on stream-open errors
     * (once chunks start flowing we don't retry, because partial output may
     * already be on screen).
     */
    public async generateContentStreamWithFallback(
        settings: Settings,
        preferredModel: string,
        contents: unknown,
        config: LegacyGenerationConfig = {},
        options: { timeoutMs?: number; maxCandidates?: number; maxRetries?: number; signal?: AbortSignal } = {}
    ): Promise<AsyncIterable<unknown>> {
        // The proxy is attempted first for *any* provider it can route, so the
        // server-side key is used whenever one is configured. Tools are
        // excluded: the proxy's text contract carries no
        // `functionCalls`, so routing them through it would silently drop the
        // model's ability to call a function.
        const streamProxyProvider = proxyProviderFor(settings);
        const streamProxyable = !config.tools && !config.toolConfig;
        if (streamProxyProvider && streamProxyable && isAiProxyConfigured()) {
            const outcome = await streamAiProxyDetailed({
                provider: streamProxyProvider,
                model: preferredModel,
                contents,
                systemInstruction: typeof config.systemInstruction === 'string' ? config.systemInstruction : undefined,
                temperature: typeof config.temperature === 'number' ? config.temperature : undefined,
                maxOutputTokens: typeof config.maxOutputTokens === 'number' ? config.maxOutputTokens : undefined,
                responseMimeType: typeof config.responseMimeType === 'string' ? config.responseMimeType : undefined,
                responseSchema: config.responseSchema,
                signal: options.signal,
            });
            if (isProxySuccess(outcome)) return outcome.value;
            assertDirectCallAllowed(settings, outcome);
        } else {
            // No proxy in the path: same refusal rule as the buffered call.
            assertDirectCallAllowedFor(settings, streamProxyable ? 'not-configured' : 'unsupported-request');
        }

        const streamRequest = buildCanonicalRequest(preferredModel, contents, config, options, 'generation-stream');
        const streamRoute = routeLegacyRequest(settings, streamRequest, { streaming: true });
        if (streamRoute.plan.primary.provider !== 'gemini') {
            const result = await aiRequestExecutor.executeStream(streamRoute.provider, streamRequest, undefined, {
                settings,
                routePlan: streamRoute.plan,
                resolveProvider: streamRoute.resolveProvider,
            });
            return result.stream;
        }

        return this.runWithModelFallback(settings, preferredModel, async (model, ai, signal) => {
            return ai.models.generateContentStream({
                model,
                contents: contents as GeminiContents,
                config: atGeminiBoundary({ ...config, abortSignal: signal }),
            });
        }, options);
    }

    private isModelFallbackCandidate(error: unknown): boolean {
        // Original cases: model id not recognised by the API. These imply the
        // request can never succeed against this model — a fallback to any
        // other model id is the only way forward.
        const shaped = (error ?? {}) as { message?: unknown; status?: unknown };
        const message = String(shaped.message || '').toLowerCase();
        const status = Number(shaped.status || 0);
        if (
            status === 400 ||
            status === 404 ||
            message.includes('not found') ||
            message.includes('unsupported') ||
            message.includes('invalid model') ||
            message.includes('unknown model')
        ) {
            return true;
        }

        // Saturation / overload: the requested model returned 503 or 429 even
        // after exhausting retryWithBackoff. Each model in the fallback chain
        // has an independent capacity pool, so trying the next model is the
        // single biggest stability win during peak hours — without it the
        // user just sees "Modelo saturado" and gets stuck even though Pro or
        // Flash-Lite would have answered.
        if (error instanceof AIServiceError) {
            return error.category === 'overloaded' || error.category === 'rate-limit';
        }
        return false;
    }
}

/** La instancia que usan las fachadas que no pasan por el motor. */
export const legacyTransport = new LegacyGenerationTransport();

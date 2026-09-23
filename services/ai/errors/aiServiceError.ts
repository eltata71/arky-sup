/**
 * The error surface of AI generation, and the classifier that produces it.
 *
 * These three lived in `services/geminiService.ts`, and `services/ai/index.ts`
 * re-exported them from there — so the public API of the provider-agnostic
 * layer resolved, symbol by symbol, to the legacy engine. Seven screens catch
 * `AIServiceError`; every one of them was reaching the monolith through a
 * barrel that exists to hide it.
 *
 * Nothing about the behaviour changed in the move. What changed is the
 * direction of the dependency: the engine now imports its errors from the
 * layer, instead of the layer publishing the engine's.
 *
 * `classifyAIError` still recognises Gemini's error shapes — it has to, since
 * that is one of the two providers — but recognising a provider's payload is
 * an adapter's job, and this is where adapters report to. `AIErrorClassifier`
 * beside it is the per-provider strategy; this is the shared entry point that
 * predates it and that the whole UI catches.
 */

import type { DiagramFailureReason } from '../../../lib/diagram';
import type { AIErrorCategory, AIErrorSource } from '../core';

/**
 * Internal signal used when a C4 artifact fell back to the deterministic
 * skeleton after exhausting AI retries. It carries rendered Mermaid in
 * `sampleMermaid`; the public generation wrapper catches it and returns that
 * renderable fallback instead of breaking the user flow.
 */
export class C4SelfHealingError extends Error {
    public readonly reason: DiagramFailureReason;
    public readonly attempts: number;
    public readonly sampleMermaid: string;
    public readonly warnings: string[];
    constructor(message: string, info: { reason: DiagramFailureReason; attempts: number; sampleMermaid: string; warnings: string[] }) {
        super(message);
        this.name = 'C4SelfHealingError';
        this.reason = info.reason;
        this.attempts = info.attempts;
        this.sampleMermaid = info.sampleMermaid;
        this.warnings = info.warnings;
    }
}

//
// Callers (UI layer) need to know whether an error is recoverable, what to
// show the user, and whether a retry is likely to succeed.  We expose a
// stable error category so the chat panel can render the right CTA without
// having to parse Gemini's JSON shape.

export class AIServiceError extends Error {
    public readonly category: AIErrorCategory;
    public readonly status?: number;
    public readonly retryable: boolean;
    public readonly userMessage: string;
    public override readonly cause?: unknown;
    public readonly retryAfterMs?: number;
    public readonly source: AIErrorSource;
    public readonly errorCode?: string;
    constructor(category: AIErrorCategory, status: number | undefined, message: string, userMessage: string, retryable: boolean, cause?: unknown, retryAfterMs?: number, options?: { source?: AIErrorSource; errorCode?: string }) {
        super(message);
        this.name = 'AIServiceError';
        this.category = category;
        this.status = status;
        this.retryable = retryable;
        this.userMessage = userMessage;
        this.cause = cause;
        this.retryAfterMs = retryAfterMs;
        this.source = options?.source ?? defaultAiErrorSource(category, status);
        this.errorCode = options?.errorCode;
    }
}

function defaultAiErrorSource(category: AIErrorCategory, status?: number): AIErrorSource {
    if (category === 'rate-limit' || status === 429) return 'provider-rate-limit';
    if (category === 'overloaded') return 'overloaded';
    if (category === 'auth') return 'auth';
    if (category === 'network' || category === 'timeout') return 'network';
    return 'unknown';
}


function readGeminiErrorShape(error: unknown): { status?: number; message?: string; retryAfterMs?: number } {
    if (!error || typeof error !== 'object') return {};
    const e = error as { status?: number; code?: number; message?: string; retryAfter?: number | string; retryAfterMs?: number; headers?: { get?: (name: string) => string | null }; error?: { code?: number; status?: string; message?: string } };
    // Some SDK errors put the payload under `.error`, others put it on the root.
    let status = e.status ?? e.code ?? e.error?.code;
    const rawMessage = e.message ?? e.error?.message;
    let message = rawMessage;
    const retryAfterHeader = e.headers?.get?.('retry-after') ?? e.headers?.get?.('Retry-After') ?? undefined;
    const retryAfterValue = e.retryAfterMs ?? e.retryAfter ?? retryAfterHeader;
    const retryAfterMs = (() => {
        if (typeof retryAfterValue === 'number') return retryAfterValue > 1000 ? retryAfterValue : retryAfterValue * 1000;
        if (typeof retryAfterValue === 'string' && retryAfterValue.trim().length > 0) {
            const seconds = Number(retryAfterValue);
            if (Number.isFinite(seconds)) return seconds * 1000;
            const dateMs = Date.parse(retryAfterValue);
            if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
        }
        return undefined;
    })();

    // The @google/genai SDK throws ApiError whose .message is the stringified
    // server JSON: `{"error":{"code":500,"message":"...","status":"INTERNAL"}}`.
    // Extract the inner code + message so callers see the real cause instead
    // of an opaque blob, AND so the classifier can route 5xx correctly.
    if (typeof rawMessage === 'string') {
        // Pattern 1: the SDK prefix "got status: <code>. {...}"
        const prefixMatch = rawMessage.match(/got status:\s*(\d{3})/i);
        if (prefixMatch && status === undefined) {
            status = Number(prefixMatch[1]);
        }
        // Pattern 2: embedded JSON body
        const jsonStart = rawMessage.indexOf('{');
        if (jsonStart >= 0) {
            try {
                const parsed = JSON.parse(rawMessage.slice(jsonStart)) as {
                    error?: { code?: number; status?: string; message?: string };
                };
                if (parsed.error) {
                    if (status === undefined && typeof parsed.error.code === 'number') status = parsed.error.code;
                    if (typeof parsed.error.message === 'string' && parsed.error.message.length > 0) {
                        message = parsed.error.message;
                    } else if (typeof parsed.error.status === 'string' && parsed.error.status.length > 0) {
                        message = parsed.error.status;
                    }
                }
            } catch {
                // Body wasn't valid JSON — keep the original stringified message.
            }
        }
    }
    return { status, message, retryAfterMs };
}

export function isTransientGeminiError(error: unknown): boolean {
    const { status, message } = readGeminiErrorShape(error);
    if (status === 503 || status === 429) return true;
    // Some 5xx classes (502 Bad Gateway, 504 Gateway Timeout) bubble through
    // the SDK as numeric status only. Treat the whole 5xx family as transient
    // so the UI doesn't surface an infrastructure blip as a permanent error.
    if (typeof status === 'number' && status >= 500 && status <= 599) return true;
    const errName = (error && typeof error === 'object' && 'name' in error)
        ? String((error as { name?: unknown }).name ?? '').toLowerCase()
        : '';
    if (errName === 'aborterror' || errName === 'timeouterror') return true;
    const m = (message ?? '').toLowerCase();
    return (
        m.includes('fetch failed') ||
        m.includes('failed to fetch') ||
        m.includes('load failed') ||         // iOS / Safari generic abort
        m.includes('networkerror') ||
        m.includes('econnreset') ||
        m.includes('econnrefused') ||
        m.includes('etimedout') ||
        m.includes('network') ||
        m.includes('overloaded') ||
        m.includes('unavailable') ||
        m.includes('high demand') ||
        m.includes('temporarily') ||
        m.includes('aborted') ||
        m.includes('connection') ||
        m.includes('socket')
    );
}

export function classifyAIError(error: unknown): AIServiceError {
    if (error instanceof AIServiceError) return error;
    const { status, message, retryAfterMs } = readGeminiErrorShape(error);
    const lower = (message ?? '').toLowerCase();

    // 5xx family — Gemini periodically returns 500/502/503/504 during peak
    // hours or transient infrastructure blips. These are *all* recoverable;
    // the user-facing message stays the same so the UI doesn't have to learn
    // every server status code.
    if (
        status === 503 ||
        status === 500 ||
        status === 502 ||
        status === 504 ||
        (typeof status === 'number' && status >= 500 && status <= 599) ||
        lower.includes('high demand') ||
        lower.includes('overloaded') ||
        lower.includes('unavailable') ||
        lower.includes('internal') ||
        lower.includes('bad gateway') ||
        lower.includes('gateway timeout')
    ) {
        return new AIServiceError(
            'overloaded',
            status,
            message ?? 'Gemini overloaded',
            'El modelo de IA está saturado o experimentando un problema interno. Reintenta en unos segundos — suele resolverse rápido.',
            true,
            error,
        );
    }
    if (status === 429 || lower.includes('rate') || lower.includes('quota')) {
        return new AIServiceError(
            'rate-limit',
            status,
            message ?? 'Rate limited',
            'Has alcanzado el límite de peticiones por minuto. Espera unos segundos antes de reintentar.',
            true,
            error,
            retryAfterMs,
        );
    }
    if (status === 401 || status === 403 || lower.includes('api key') || lower.includes('permission')) {
        return new AIServiceError(
            'auth',
            status,
            message ?? 'Auth failed',
            'No se pudo autenticar con la API de Gemini. Revisa la clave de API en Configuración.',
            false,
            error,
        );
    }
    if (
        lower.includes('json parse error') ||
        lower.includes('json.parse') ||
        lower.includes('unexpected token') ||
        lower.includes("expected ']'") ||
        lower.includes('expected \']') ||
        lower.includes('unterminated string') ||
        lower.includes('malformed') ||
        lower.includes('not valid json') ||
        (error instanceof SyntaxError && lower.includes('json'))
    ) {
        return new AIServiceError(
            'malformed-response',
            status,
            message ?? 'Malformed model response',
            'El modelo o el SDK devolvió una respuesta malformada. Se usará la ruta local determinística cuando sea posible.',
            true,
            error,
        );
    }
    if (status === 400 || lower.includes('invalid')) {
        return new AIServiceError(
            'invalid-request',
            status,
            message ?? 'Invalid request',
            'La solicitud al modelo no es válida. Si el problema persiste, simplifica el contexto y reintenta.',
            false,
            error,
        );
    }
    if (lower.includes('timeout') || lower.includes('timed out')) {
        return new AIServiceError(
            'timeout',
            status,
            message ?? 'Timeout',
            'El modelo tardó demasiado en responder. Reintenta o reduce la complejidad de la generación.',
            true,
            error,
        );
    }
    // Network family — includes the generic "Load failed" Safari/iOS surfaces
    // when a fetch is killed mid-flight (CORS preflight retry, throttled
    // background tab, DNS hiccup). Keeping all of these under one user-facing
    // category gives a stable, recoverable UX instead of surfacing them as
    // an opaque "Ocurrió un error inesperado" modal.
    if (
        lower.includes('fetch failed') ||
        lower.includes('failed to fetch') ||
        lower.includes('load failed') ||
        lower.includes('networkerror') ||
        lower.includes('econnreset') ||
        lower.includes('econnrefused') ||
        lower.includes('etimedout') ||
        lower.includes('network') ||
        lower.includes('connection')
    ) {
        return new AIServiceError(
            'network',
            status,
            message ?? 'Network error',
            'No se pudo contactar al modelo de IA. Verifica tu conexión y reintenta — el sistema reintentará automáticamente.',
            true,
            error,
        );
    }
    const errName = (error && typeof error === 'object' && 'name' in error)
        ? String((error as { name?: unknown }).name ?? '').toLowerCase()
        : '';
    if (errName.includes('apierror') || errName.includes('google') || lower.includes('@google/genai') || lower.includes('sdk')) {
        return new AIServiceError(
            'sdk',
            status,
            message ?? 'Gemini SDK error',
            'El SDK de Gemini devolvió un error antes de completar la respuesta. Se conservará la ruta de recuperación local cuando aplique.',
            true,
            error,
        );
    }
    if (errName === 'aborterror' || errName === 'timeouterror' || lower.includes('aborted')) {
        return new AIServiceError(
            'timeout',
            status,
            message ?? 'Aborted',
            'La conexión con el modelo se interrumpió. Reintenta — el sistema reintentará automáticamente.',
            true,
            error,
        );
    }
    // Unknown category — we couldn't extract a status code or recognise any
    // pattern. Dump the full error shape so it shows up in the browser
    // console; this is the only signal we have when remote diagnosis isn't
    // possible. The message is also surfaced verbatim in the friendly
    // userMessage so the architect can self-diagnose (e.g. "API key invalid",
    // "model not found in this region", quota messages).
    if (error && typeof error === 'object') {
        try {
            console.warn('[geminiService.classifyAIError] Unknown error shape:', {
                name: (error as { name?: unknown }).name,
                status,
                message,
                rawKeys: Object.keys(error as object),
                rawSample: JSON.stringify(error, Object.getOwnPropertyNames(error as object)).slice(0, 500),
            });
        } catch {
            console.warn('[geminiService.classifyAIError] Unknown error (unstringifiable)', error);
        }
    }
    const verbosePreview = (message ?? '').toString().slice(0, 200);
    return new AIServiceError(
        'unknown',
        status,
        message ?? 'Unknown Gemini error',
        verbosePreview
            ? `El modelo devolvió un error no clasificado: "${verbosePreview}". Reintenta o revisa la API Key.`
            : 'Ocurrió un error inesperado al hablar con el modelo. Reintenta en unos segundos.',
        true,
        error,
    );
}

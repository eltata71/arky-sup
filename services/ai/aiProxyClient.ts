/**
 * Client for the provider-agnostic serverless proxy (`api/ai.ts`).
 *
 * The app is frontend-only, so a global API key would otherwise ship inside
 * the browser bundle. Generation goes through the serverless function instead
 * and the key stays on the server: `VITE_AI_PROXY_URL` points at it, and a
 * production build that sets nothing uses the `/api/ai` this repository
 * deploys beside it (see `DEFAULT_AI_PROXY_PATH`).
 *
 * This module reports; it does not decide. Every call has two surfaces:
 *
 *  - `callAiProxyDetailed()` / `streamAiProxyDetailed()` return an
 *    `AiProxyOutcome` that says *what* happened — throttled, unauthenticated,
 *    unreachable, empty body. `services/ai/aiProxyPolicy` turns that into a
 *    decision.
 *  - `callAiProxy()` / `streamAiProxy()` keep the original `T | null` shape for
 *    the callers that only ever asked "did it work?".
 *
 * The `null` form is lossy on purpose-by-history: it made a 429 and a DNS
 * failure indistinguishable, so a caller could only ever do one thing with
 * either — retry directly against the provider, with the key the proxy exists
 * to hide. New call sites should prefer the detailed form.
 */

import { buildProxyAuthHeaders } from './proxyAuthHeaders';
import { newTraceId } from '../../lib/traceId';
import {
  classifyProxyStatus,
  parseRetryAfterMs,
  isProxySuccess,
  proxyFailure,
  proxySuccess,
  type AiProxyOutcome,
} from './aiProxyPolicy';
import { assertPromptAllowed } from './core/requestGuards';

export interface AiProxyRequest {
  provider: 'gemini' | 'openrouter';
  model: string;
  contents: unknown;
  systemInstruction?: string;
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
  signal?: AbortSignal;
  /**
   * Correlates this call with the proxy's log line and with the observability
   * event the caller records. Minted here when the caller does not supply one,
   * so a request is never untraceable.
   */
  traceId?: string;
}

const SESSION_STORAGE_KEY = 'arky_ai_proxy_session_id';

/**
 * The proxy this repository ships, at the path it deploys to.
 *
 * `api/ai.ts` is built and served from the same origin as the bundle that
 * calls it, so in a production build the endpoint is knowable without being
 * told. It used to have to be told — `VITE_AI_PROXY_URL` unset meant "no
 * proxy", and since production is fail-closed that turned a missing dashboard
 * variable into every AI feature refusing to run, pointing at a route the same
 * deployment was already serving. A default that names the artefact we ship is
 * not a guess; it is the one endpoint we can be sure about.
 *
 * A production build served from a host without the function still degrades
 * honestly: the request comes back 404, or 200 with the SPA's HTML, and
 * `classifyEndpointMiss` reports `not-configured` — the same outcome as before,
 * reached by asking instead of by assuming.
 */
export const DEFAULT_AI_PROXY_PATH = '/api/ai';

export function getAiProxyUrl(): string | null {
  const endpoint = (import.meta.env.VITE_AI_PROXY_URL ?? '').toString().trim();
  if (endpoint.length > 0) return endpoint;
  // Only in a production build. In development the direct path is allowed, so
  // defaulting would add a failing round-trip before every call for nothing:
  // `npm run dev` serves no serverless function.
  return import.meta.env.PROD ? DEFAULT_AI_PROXY_PATH : null;
}

export function isAiProxyConfigured(): boolean {
  return getAiProxyUrl() !== null;
}

/** Whether the endpoint in use is the built-in default rather than a configured one. */
function isDefaultEndpoint(): boolean {
  return (import.meta.env.VITE_AI_PROXY_URL ?? '').toString().trim().length === 0;
}

const headerOf = (response: Response, name: string): string =>
  (response.headers?.get?.(name) ?? '').toString();

/**
 * Distinguish "the proxy answered badly" from "there is no proxy at this path".
 *
 * Two shapes say the endpoint is not the proxy: a 404, and HTML — which is what
 * a SPA catch-all rewrite serves for `/api/ai` on a host that deploys no
 * function, with a cheerful 200. Reported as `provider-error` or `malformed`
 * either would read as a transient fault and invite a retry that can never
 * succeed; `not-configured` says what to fix.
 *
 * Anything else is left alone on purpose. A missing or unexpected content type
 * on a 2xx is the proxy answering oddly, and `malformed` already covers it —
 * guessing harder here would turn a real proxy fault into a configuration
 * message and send someone to edit environment variables that are correct.
 */
function classifyEndpointMiss(response: Response): boolean {
  if (response.status === 404) return true;
  return headerOf(response, 'content-type').toLowerCase().includes('html');
}

/**
 * El envoltorio de error que `api/ai.ts` devuelve, leído una sola vez y usado
 * por los dos caminos.
 *
 * Antes lo leía únicamente la llamada con respuesta completa; la llamada por
 * streaming se quedaba con el estado HTTP. Eso hacía que un 429 del Laboratorio
 * de IA —que emite en streaming— llegara sin `error`, sin `source` y sin
 * `requestId`, es decir sin nada con lo que atribuirlo, y que el caso
 * «el proxy está desplegado pero el servidor no tiene clave» se reportara ahí
 * como fallo de proveedor reintentable en vez de como configuración.
 *
 * Nunca devuelve el prompt: el envoltorio del proxy no lo incluye, y el texto
 * crudo se recorta a 200 caracteres antes de viajar a ninguna parte.
 */
interface ProxyErrorEnvelope {
  detail: string;
  serverCode?: string;
  serverSource?: string;
  provider?: string;
  requestId?: string;
}

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

async function readProxyErrorEnvelope(response: Response): Promise<ProxyErrorEnvelope> {
  const raw = await response.text().catch(() => '');
  const detail = raw.slice(0, 200);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      detail,
      serverCode: asText(parsed.error),
      serverSource: asText(parsed.source),
      provider: asText(parsed.provider),
      requestId: asText(parsed.requestId),
    };
  } catch {
    // Un cuerpo que no es JSON sigue siendo información — se conserva como
    // `detail` y los campos estructurados quedan ausentes, que es lo honesto.
    return { detail };
  }
}

/**
 * La regla que ambos caminos comparten: un proxy desplegado sin clave de
 * proveedor es configuración, no una caída. Responde 500, y «reintente en unos
 * momentos» mandaría al operador a esperar algo que no cambia hasta que se
 * defina `GEMINI_API_KEY` en el servidor.
 */
function failureFromEnvelope(
  response: Response,
  envelope: ProxyErrorEnvelope,
  endpoint: string,
  traceId: string,
) {
  if (envelope.serverCode === 'missing_provider_api_key' || envelope.detail.includes('missing_provider_api_key')) {
    return proxyFailure('not-configured', {
      status: response.status,
      retryable: false,
      detail: `El proxy (${endpoint}) responde, pero el servidor no tiene clave de proveedor.`,
      serverCode: envelope.serverCode ?? 'missing_provider_api_key',
      serverSource: envelope.serverSource,
      provider: envelope.provider,
      traceId: envelope.requestId ?? traceId,
    });
  }

  return proxyFailure(classifyProxyStatus(response.status), {
    status: response.status,
    retryAfterMs: parseRetryAfterMs(response.headers?.get?.('retry-after')),
    detail: envelope.detail,
    serverCode: envelope.serverCode,
    serverSource: envelope.serverSource,
    provider: envelope.provider,
    // El `requestId` del proxy es el id con el que quedó su línea de log. Si
    // viene, manda: correlacionar con el id acuñado en el cliente obliga a
    // cruzar dos identificadores a mano.
    traceId: envelope.requestId ?? traceId,
  });
}

/** Stable per-tab identity so the proxy rate-limits per session, not per IP. */
function getSessionId(): string {
  const generated = `ai-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return generated;
  }
}

/**
 * Body shared by the buffered and streaming calls.
 *
 * The guardrail runs on the serialised body rather than on one field, because
 * a credential pasted into a project reaches the proxy through whichever of
 * them happens to carry it — the prompt, the system instruction, an example in
 * a schema. What must not travel is the request, not a part of it.
 */
function buildRequestBody(request: AiProxyRequest, stream: boolean): string {
  const body = JSON.stringify({
    provider: request.provider,
    model: request.model,
    contents: request.contents,
    systemInstruction: request.systemInstruction,
    temperature: request.temperature,
    maxOutputTokens: request.maxOutputTokens,
    responseMimeType: request.responseMimeType,
    responseSchema: request.responseSchema,
    ...(stream ? { stream: true } : {}),
  });
  assertPromptAllowed(`ai-proxy:${request.provider}`, body, request.provider);
  return body;
}

/**
 * Call the proxy and report the outcome.
 *
 * Never throws: a transport error is a `network` failure, not an exception, so
 * the caller's decision stays in one place instead of being split across a
 * return value and a catch block.
 */
export async function callAiProxyDetailed(request: AiProxyRequest): Promise<AiProxyOutcome<string>> {
  const endpoint = getAiProxyUrl();
  const traceId = request.traceId ?? newTraceId('ai-proxy');
  if (!endpoint) return proxyFailure('not-configured', { retryable: false, traceId });

  // Built outside the `try` on purpose: this is where the guardrail runs, and
  // this function's catch turns everything into a `network` outcome. A refusal
  // swallowed into an outcome is a refusal the caller answers by trying the
  // direct provider call instead — the one route a blocked prompt must not
  // find.
  const body = buildRequestBody(request, false);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: await buildProxyAuthHeaders(getSessionId(), traceId),
      body,
      signal: request.signal,
    });

    if (classifyEndpointMiss(response)) {
      return proxyFailure('not-configured', {
        status: response.status,
        retryable: false,
        detail: isDefaultEndpoint()
          ? `No hay proxy de IA en ${endpoint} en este despliegue.`
          : `El endpoint configurado (${endpoint}) no responde como el proxy de IA.`,
        traceId,
      });
    }

    if (!response.ok) {
      return failureFromEnvelope(response, await readProxyErrorEnvelope(response), endpoint, traceId);
    }

    const data = (await response.json().catch(() => null)) as { text?: unknown } | null;
    if (typeof data?.text === 'string' && data.text.length > 0) return proxySuccess(data.text);
    return proxyFailure('malformed', { status: response.status, retryable: true, traceId });
  } catch (error) {
    return proxyFailure('network', {
      detail: error instanceof Error ? error.message : String(error),
      traceId,
    });
  }
}

/**
 * Call the proxy. Returns the generated text, or `null` when the proxy is not
 * configured or the request failed for any reason (network, rate limit,
 * provider error, malformed payload).
 *
 * Kept for the callers written against the original contract. It discards the
 * reason — use {@link callAiProxyDetailed} when the reason matters, which is
 * any call site that has to decide whether falling back is acceptable.
 */
export async function callAiProxy(request: AiProxyRequest): Promise<string | null> {
  const outcome = await callAiProxyDetailed(request);
  if (isProxySuccess(outcome)) return outcome.value;
  if (outcome.reason !== 'not-configured') {
    console.warn('[aiProxy] Proxy call failed; caller decides whether to fall back.', {
      reason: outcome.reason,
      status: outcome.status,
      detail: outcome.detail?.slice(0, 200),
    });
  }
  return null;
}

export interface AiProxyStreamChunk {
  text: string;
}

/**
 * Streaming counterpart of {@link callAiProxyDetailed}. POSTs with
 * `stream: true`; the server answers with an SSE stream
 * (`data: {"text":"…"}\n\n` … `data: [DONE]\n\n`). Each chunk carries the same
 * `{ text }` shape the direct Gemini stream exposes, so callers stay agnostic.
 *
 * The outcome describes the *open* only. Once chunks flow, a mid-stream
 * interruption ends the iterator (partial output may already be on screen);
 * that is a rendering concern, not a credential one, so it stays where it is.
 */
export async function streamAiProxyDetailed(
  request: AiProxyRequest,
): Promise<AiProxyOutcome<AsyncIterable<AiProxyStreamChunk>>> {
  const endpoint = getAiProxyUrl();
  const traceId = request.traceId ?? newTraceId('ai-proxy-stream');
  if (!endpoint) return proxyFailure('not-configured', { retryable: false, traceId });

  // Outside the `try`, for the reason the buffered call gives.
  const body = buildRequestBody(request, true);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: await buildProxyAuthHeaders(getSessionId(), traceId),
      body,
      signal: request.signal,
    });

    if (classifyEndpointMiss(response)) {
      return proxyFailure('not-configured', {
        status: response.status,
        retryable: false,
        detail: isDefaultEndpoint()
          ? `No hay proxy de IA en ${endpoint} en este despliegue.`
          : `El endpoint configurado (${endpoint}) no responde como el proxy de IA.`,
        traceId,
      });
    }

    if (!response.ok) {
      return failureFromEnvelope(response, await readProxyErrorEnvelope(response), endpoint, traceId);
    }
    if (!response.body) {
      return proxyFailure('malformed', { status: response.status, retryable: true, traceId });
    }

    return proxySuccess(parseSseStream(response.body));
  } catch (error) {
    return proxyFailure('network', {
      detail: error instanceof Error ? error.message : String(error),
      traceId,
    });
  }
}

/**
 * `T | null` form of {@link streamAiProxyDetailed}, for the existing callers.
 */
export async function streamAiProxy(
  request: AiProxyRequest,
): Promise<AsyncIterable<AiProxyStreamChunk> | null> {
  const outcome = await streamAiProxyDetailed(request);
  if (isProxySuccess(outcome)) return outcome.value;
  if (outcome.reason !== 'not-configured') {
    console.warn('[aiProxy] Proxy stream failed; caller decides whether to fall back.', {
      reason: outcome.reason,
      status: outcome.status,
    });
  }
  return null;
}

/**
 * Parse a `text/event-stream` body into the `{ text }` chunk contract.
 * Tolerant of CRLF, blank lines and malformed/keep-alive frames — the proxy
 * only ever emits well-formed `data:` JSON for token deltas plus a terminal
 * `[DONE]`, so anything unrecognised is skipped.
 */
export function parseSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<AiProxyStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice('data:'.length).trim();
          if (data === '[DONE]') return;
          if (!data) continue;
          try {
            const parsed = JSON.parse(data) as { text?: unknown };
            if (typeof parsed.text === 'string' && parsed.text.length > 0) {
              yield { text: parsed.text };
            }
          } catch {
            // Skip malformed or non-delta frames (e.g. keep-alive comments).
          }
        }
      }
    },
  };
}

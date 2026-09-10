import { GoogleGenAI } from '@google/genai';
import { authenticateProxyCaller } from './_shared/authenticateProxyCaller';
import { toGeminiSchema, toResponseFormat } from '../services/ai/schema';
import type { IncomingMessage } from 'node:http';
import {
  consumeRateLimit,
  isModelAllowed,
  createProxyLogger,
  getClientId,
  resolveRequestId,
  readBody,
  readProviderRetryAfterMs,
  readStatus,
  resetRateLimitBuckets,
  sendJson,
  type ResponseWithJson,
} from './_shared/proxyRuntime';

/**
 * Provider-agnostic serverless AI proxy.
 *
 * The app is frontend-only, so a global `VITE_*` API key necessarily ships in
 * the browser bundle. Pointing `VITE_AI_PROXY_URL` at this endpoint moves the
 * key server-side: the client sends the prompt, the function holds
 * `GEMINI_API_KEY` / `OPENROUTER_API_KEY` (no `VITE_` prefix → never bundled)
 * and forwards the call to whichever provider the caller selected.
 *
 * Contract (POST):
 *   { provider, model, prompt?, contents?, systemInstruction?, temperature?,
 *     maxOutputTokens?, responseMimeType?, responseSchema? }
 *   → 200 { requestId, text, provider, model }
 *   → 4xx/5xx { requestId, error, source, retryAfterMs? }
 *
 * Callers must keep working without this endpoint: the client falls back to a
 * direct provider call when the proxy is unset or fails.
 */

type ProxyProvider = 'gemini' | 'openrouter';

interface AiProxyRequestBody {
  provider?: unknown;
  model?: unknown;
  prompt?: unknown;
  contents?: unknown;
  stream?: unknown;
  systemInstruction?: unknown;
  temperature?: unknown;
  maxOutputTokens?: unknown;
  responseMimeType?: unknown;
  responseSchema?: unknown;
}

interface OpenRouterChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

const RATE_LIMIT_ENV = 'AI_PROXY_MAX_REQUESTS_PER_WINDOW';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_OPENROUTER_MODEL = 'openrouter/auto';

const logProxyEvent = createProxyLogger('[api/ai]');

/** HTTP error carrying the provider status so the envelope stays faithful. */
class ProviderHttpError extends Error {
  readonly status: number;
  readonly retryAfter?: string;

  constructor(status: number, message: string, retryAfter?: string) {
    super(message);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.retryAfter = retryAfter ?? undefined;
  }
}

const resolveProvider = (raw: unknown): ProxyProvider => (raw === 'openrouter' ? 'openrouter' : 'gemini');

/**
 * Server-side key lookup.
 *
 * Deliberately does NOT accept the `VITE_`-prefixed names. Vite inlines every
 * `VITE_*` variable into the client bundle, so honouring them here rewarded a
 * dangerous configuration: setting `VITE_GEMINI_API_KEY` in Vercel satisfied
 * this proxy *and* shipped the key to every browser, which is the exact
 * exposure the proxy exists to prevent. Missing keys now fail loudly instead.
 */
const resolveApiKey = (provider: ProxyProvider): string =>
  provider === 'openrouter'
    ? (process.env.OPENROUTER_API_KEY || '').trim()
    : (process.env.GEMINI_API_KEY || '').trim();

/**
 * Flatten the `contents` union accepted by the client seam (string, Gemini
 * `Content[]`, `{ text }` items) into a plain prompt string. Mirrors
 * `GeminiService.contentsToPrompt` so both transports see the same text.
 */
const contentsToPrompt = (contents: unknown): string => {
  if (typeof contents === 'string') return contents;
  if (!Array.isArray(contents)) return contents == null ? '' : String(contents);

  const lines: string[] = [];
  for (const item of contents) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { text?: unknown; parts?: unknown };
    if (typeof record.text === 'string') {
      lines.push(record.text);
      continue;
    }
    if (Array.isArray(record.parts)) {
      for (const part of record.parts) {
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          lines.push((part as { text: string }).text);
        }
      }
    }
  }
  return lines.join('\n');
};

const callGemini = async (
  apiKey: string,
  body: AiProxyRequestBody,
  model: string,
): Promise<string> => {
  const contents = body.contents ?? (typeof body.prompt === 'string' ? body.prompt : '');
  const config: Record<string, unknown> = {};
  if (typeof body.systemInstruction === 'string') config.systemInstruction = body.systemInstruction;
  if (typeof body.temperature === 'number') config.temperature = body.temperature;
  if (typeof body.maxOutputTokens === 'number') config.maxOutputTokens = body.maxOutputTokens;
  if (typeof body.responseMimeType === 'string') config.responseMimeType = body.responseMimeType;
  // The schema arrives in whichever dialect the caller wrote and is translated
  // to Google's here, so structured output survives the proxy round-trip
  // regardless of how far the caller has migrated.
  if (body.responseSchema && typeof body.responseSchema === 'object') {
    config.responseSchema = toGeminiSchema(body.responseSchema);
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: contents as never,
    config,
  });
  return response.text || '';
};

const callOpenRouter = async (
  apiKey: string,
  body: AiProxyRequestBody,
  model: string,
): Promise<string> => {
  const prompt = typeof body.prompt === 'string' && body.prompt.length > 0
    ? body.prompt
    : contentsToPrompt(body.contents);

  const messages: Array<{ role: string; content: string }> = [];
  if (typeof body.systemInstruction === 'string' && body.systemInstruction.length > 0) {
    messages.push({ role: 'system', content: body.systemInstruction });
  }
  messages.push({ role: 'user', content: prompt });

  const payload: Record<string, unknown> = { model, messages };
  if (typeof body.temperature === 'number') payload.temperature = body.temperature;
  if (typeof body.maxOutputTokens === 'number') payload.max_tokens = body.maxOutputTokens;
  // A schema is honoured as a schema. Only a JSON request that carries no
  // schema falls back to `json_object`, which constrains syntax alone.
  if (body.responseSchema && typeof body.responseSchema === 'object') {
    payload.response_format = toResponseFormat(body.responseSchema);
  } else if (body.responseMimeType === 'application/json') {
    payload.response_format = { type: 'json_object' };
  }

  const response = await fetch(OPENROUTER_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ProviderHttpError(
      response.status,
      `OpenRouter responded ${response.status}: ${detail.slice(0, 300)}`,
      response.headers.get('retry-after') ?? undefined,
    );
  }

  const data = (await response.json()) as OpenRouterChatResponse;
    return data.choices?.[0]?.message?.content || '';
  };

  /* ------------------------------------------------------------------ *
   * Streaming (SSE)
   * ------------------------------------------------------------------ */

  const writeSseHeaders = (res: ResponseWithJson): void => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
  };

  const writeSseEvent = (res: ResponseWithJson, data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const writeSseDone = (res: ResponseWithJson): void => {
    res.write('data: [DONE]\n\n');
    res.end();
  };

  /**
   * Open a Gemini streaming generation and wrap it into an async iterable of
   * plain text deltas. The stream is *opened* eagerly (before SSE headers go
   * out) so an auth/model error is still reported via the normal JSON envelope.
   */
  const openGeminiStream = async (
    apiKey: string,
    body: AiProxyRequestBody,
    model: string,
  ): Promise<AsyncIterable<string>> => {
    const contents = body.contents ?? (typeof body.prompt === 'string' ? body.prompt : '');
    const config: Record<string, unknown> = {};
    if (typeof body.systemInstruction === 'string') config.systemInstruction = body.systemInstruction;
    if (typeof body.temperature === 'number') config.temperature = body.temperature;
    if (typeof body.maxOutputTokens === 'number') config.maxOutputTokens = body.maxOutputTokens;
    if (typeof body.responseMimeType === 'string') config.responseMimeType = body.responseMimeType;
    if (body.responseSchema && typeof body.responseSchema === 'object') {
      config.responseSchema = toGeminiSchema(body.responseSchema);
    }

    const ai = new GoogleGenAI({ apiKey });
    const upstream = await ai.models.generateContentStream({
      model,
      contents: contents as never,
      config,
    });

    return {
      async *[Symbol.asyncIterator]() {
        for await (const chunk of upstream) {
          const text = (chunk as { text?: unknown })?.text;
          if (typeof text === 'string' && text.length > 0) yield text;
        }
      },
    };
  };

  /**
   * Open an OpenRouter streaming (`stream: true`) request and wrap the SSE
   * upstream into an iterable of plain text deltas. The HTTP handshake happens
   * eagerly so a non-2xx response still surfaces as a `ProviderHttpError` and is
   * reported with the JSON envelope before SSE headers are committed.
   */
  const openOpenRouterStream = async (
    apiKey: string,
    body: AiProxyRequestBody,
    model: string,
  ): Promise<AsyncIterable<string>> => {
    const prompt = typeof body.prompt === 'string' && body.prompt.length > 0
      ? body.prompt
      : contentsToPrompt(body.contents);

    const messages: Array<{ role: string; content: string }> = [];
    if (typeof body.systemInstruction === 'string' && body.systemInstruction.length > 0) {
      messages.push({ role: 'system', content: body.systemInstruction });
    }
    messages.push({ role: 'user', content: prompt });

    const payload: Record<string, unknown> = { model, messages, stream: true };
    if (typeof body.temperature === 'number') payload.temperature = body.temperature;
    if (typeof body.maxOutputTokens === 'number') payload.max_tokens = body.maxOutputTokens;
    if (body.responseSchema && typeof body.responseSchema === 'object') {
      payload.response_format = toResponseFormat(body.responseSchema);
    } else if (body.responseMimeType === 'application/json') {
      payload.response_format = { type: 'json_object' };
    }

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderHttpError(
        response.status,
        `OpenRouter responded ${response.status}: ${detail.slice(0, 300)}`,
        response.headers.get('retry-after') ?? undefined,
      );
    }
    if (!response.body) throw new Error('openrouter_stream_unavailable');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;

    return {
      async *[Symbol.asyncIterator]() {
        while (!done) {
          const { done: chunkDone, value } = await reader.read();
          if (chunkDone) break;
          buffer += decoder.decode(value, { stream: true });

          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line.startsWith('data:')) continue;
            const data = line.slice('data:'.length).trim();
            if (data === '[DONE]') {
              done = true;
              break;
            }
            if (!data) continue;
            try {
              const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) yield delta;
            } catch {
              // Skip keep-alive or malformed frames.
            }
          }
        }
      },
    };
  };

  export default async function handler(req: IncomingMessage, res: ResponseWithJson): Promise<void> {
  // Adopts the browser's trace id when it sent a valid one, so the log line
  // below and the observability event on the client carry the same id.
  const requestId = resolveRequestId(req, 'aiproxy');

  if (req.method !== 'POST') {
    sendJson(res, 405, { requestId, error: 'method_not_allowed', source: 'proxy' });
    return;
  }

  // ---- Authentication comes before anything that costs money -------------
  //
  // The proxy holds the operator's provider keys. Widening it to several
  // providers without a lock would have multiplied what sits behind an open
  // door, so identity is established first and everything below — the rate
  // limit included — is keyed on the result.
  const authOutcome = await authenticateProxyCaller(req);
  if (!authOutcome.allowed) {
    logProxyEvent('warn', 'unauthenticated', {
      requestId,
      source: 'auth',
      reason: authOutcome.reason,
    });
    sendJson(res, 401, {
      requestId,
      error: 'unauthenticated',
      source: 'proxy',
      reason: authOutcome.reason,
    });
    return;
  }

  const clientId = getClientId(req, authOutcome.uid);
  const rate = consumeRateLimit(clientId, RATE_LIMIT_ENV);
  if (!rate.allowed) {
    logProxyEvent('warn', 'local-rate-limit', {
      requestId,
      source: 'proxy-local-rate-limit',
      retryAfterMs: rate.retryAfterMs,
      limit: rate.limit,
      identityKind: clientId.split(':')[0],
    });
    sendJson(res, 429, {
      requestId,
      error: 'proxy_rate_limited',
      source: 'proxy',
      retryAfterMs: rate.retryAfterMs ?? 30_000,
    }, rate.retryAfterMs ?? 30_000);
    return;
  }

  let body: AiProxyRequestBody;
  try {
    body = await readBody<AiProxyRequestBody>(req);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'payload_too_large';
    logProxyEvent('warn', tooLarge ? 'payload-too-large' : 'invalid-body', { requestId, source: 'proxy' });
    sendJson(res, tooLarge ? 413 : 400, {
      requestId,
      error: tooLarge ? 'payload_too_large' : 'invalid_request_body',
      source: 'proxy',
    });
    return;
  }

  const provider = resolveProvider(body.provider);
  const apiKey = resolveApiKey(provider);
  if (!apiKey) {
    logProxyEvent('error', 'missing-api-key', { requestId, source: 'auth', provider });
    sendJson(res, 500, { requestId, error: 'missing_provider_api_key', source: 'proxy', provider });
    return;
  }

  const requestedModel = typeof body.model === 'string' ? body.model.trim() : '';
  if (requestedModel && !isModelAllowed(requestedModel)) {
    logProxyEvent('warn', 'model-not-allowed', { requestId, source: 'proxy', model: requestedModel });
    sendJson(res, 403, {
      requestId,
      error: 'model_not_allowed',
      source: 'proxy',
      model: requestedModel,
    });
    return;
  }
  const model = requestedModel || (provider === 'openrouter' ? DEFAULT_OPENROUTER_MODEL : DEFAULT_GEMINI_MODEL);

  try {
    logProxyEvent('info', 'provider-request-started', {
      requestId,
      source: provider,
      model,
      identityKind: clientId.split(':')[0],
    });

    if (body.stream === true) {
      // Open the upstream *first* so open errors (auth, 4xx, model 404) still
      // surface as the normal JSON error envelope before SSE headers go out.
      // Mid-stream failures are logged and surfaced as a terminal SSE event.
      const upstream = provider === 'openrouter'
        ? await openOpenRouterStream(apiKey, body, model)
        : await openGeminiStream(apiKey, body, model);

      writeSseHeaders(res);
      try {
        for await (const text of upstream) {
          writeSseEvent(res, { text });
        }
      } catch (error) {
        logProxyEvent('warn', 'stream-interrupted', {
          requestId,
          source: provider,
          error: error instanceof Error ? error.message : String(error),
        });
        writeSseEvent(res, { requestId, error: 'stream_interrupted' });
      }
      writeSseDone(res);
      return;
    }

    const text = provider === 'openrouter'
      ? await callOpenRouter(apiKey, body, model)
      : await callGemini(apiKey, body, model);

    sendJson(res, 200, { requestId, text, provider, model });
  } catch (error) {
    const status = error instanceof ProviderHttpError ? error.status : readStatus(error);
    const retryAfterMs = readProviderRetryAfterMs(error) ?? (status === 429 ? 30_000 : status >= 500 ? 5_000 : undefined);
    const isProviderRateLimit = status === 429;
    const isUnavailable = status >= 500;
    const code = isProviderRateLimit ? 'provider_rate_limited' : isUnavailable ? 'provider_unavailable' : 'provider_error';

    logProxyEvent(isProviderRateLimit || isUnavailable ? 'warn' : 'error', code, {
      requestId,
      source: isProviderRateLimit ? `${provider}-provider-rate-limit` : isUnavailable ? 'overloaded' : 'network',
      provider,
      status,
      retryAfterMs,
    });

    sendJson(res, status, {
      requestId,
      error: code,
      source: isProviderRateLimit || isUnavailable ? provider : 'proxy',
      provider,
      retryAfterMs,
    }, retryAfterMs);
  }
  }
export const __test__ = {
  resetRateLimitBuckets,
  contentsToPrompt,
};

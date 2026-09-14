import { GoogleGenAI } from '@google/genai';
import { authenticateProxyCaller } from './_shared/authenticateProxyCaller.js';
import type { IncomingMessage } from 'node:http';
import {
  consumeRateLimit,
  createProxyLogger,
  getClientId,
  resolveRequestId,
  readBody,
  readProviderRetryAfterMs,
  readStatus,
  resetRateLimitBuckets,
  sendJson,
  type ResponseWithJson,
} from './_shared/proxyRuntime.js';

/**
 * Gemini-only serverless proxy (legacy endpoint, wired via
 * `VITE_GEMINI_PROXY_URL`). The provider-agnostic replacement is `api/ai.ts`
 * (`VITE_AI_PROXY_URL`); this one stays for deployments already pointing at it.
 */

interface GeminiProxyRequestBody {
  model?: unknown;
  systemInstruction?: unknown;
  contents?: unknown;
  temperature?: unknown;
}

const RATE_LIMIT_ENV = 'GEMINI_PROXY_MAX_REQUESTS_PER_WINDOW';
const logProxyEvent = createProxyLogger('[api/gemini]');

export default async function handler(req: IncomingMessage, res: ResponseWithJson): Promise<void> {
  // Same correlation as `api/ai.ts`: the client's trace id wins when valid.
  const requestId = resolveRequestId(req, 'proxy');

  if (req.method !== 'POST') {
    sendJson(res, 405, { requestId, error: 'method_not_allowed', source: 'proxy' });
    return;
  }

  // Same posture as `api/ai.ts`: identity before spend. This legacy endpoint
  // holds the same key, so leaving it open would simply move the door.
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

  // `VITE_GEMINI_API_KEY` is intentionally not accepted here: Vite inlines
  // every `VITE_*` variable into the client bundle, so honouring it would
  // reward a configuration that ships the key to every browser.
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    logProxyEvent('error', 'missing-api-key', { requestId, source: 'auth' });
    sendJson(res, 500, { requestId, error: 'missing_gemini_api_key', source: 'proxy' });
    return;
  }

  try {
    const body = await readBody<GeminiProxyRequestBody>(req);
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : 'gemini-2.5-flash';
    const systemInstruction = typeof body.systemInstruction === 'string' ? body.systemInstruction : undefined;
    const contents = Array.isArray(body.contents) ? body.contents : [];
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.4;

    logProxyEvent('info', 'provider-request-started', {
      requestId,
      source: 'gemini',
      model,
      contentCount: contents.length,
      identityKind: clientId.split(':')[0],
    });

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction,
        temperature,
      },
    });

    sendJson(res, 200, { requestId, text: response.text || '' });
  } catch (error) {
    const status = readStatus(error);
    const retryAfterMs = readProviderRetryAfterMs(error) ?? (status === 429 ? 30_000 : status >= 500 ? 5_000 : undefined);
    const isProviderRateLimit = status === 429;
    const isUnavailable = status >= 500;
    const code = isProviderRateLimit ? 'provider_rate_limited' : isUnavailable ? 'gemini_unavailable' : 'gemini_error';
    const source = isProviderRateLimit || isUnavailable ? 'gemini' : 'proxy';

    logProxyEvent(isProviderRateLimit || isUnavailable ? 'warn' : 'error', code, {
      requestId,
      source: isProviderRateLimit ? 'provider-rate-limit' : isUnavailable ? 'overloaded' : 'network',
      status,
      retryAfterMs,
    });

    sendJson(res, status, {
      requestId,
      error: code,
      source,
      retryAfterMs,
    }, retryAfterMs);
  }
}

export const __test__ = {
  resetRateLimitBuckets,
  getClientId,
};

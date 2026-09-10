/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
/**
 * One id, from the browser call to the proxy log line to the recorded event.
 *
 * Before this, a failed generation produced three unrelated identifiers: the
 * AI layer's `ai-*` request id, the proxy's own `aiproxy-*` minted on the
 * server and unaware of the client, and an observability event carrying
 * neither. Correlation was missing exactly at the hop the user cannot see.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../firebase', () => ({
  auth: { currentUser: { uid: 'u1', getIdToken: vi.fn(async () => 'token') } },
}));

const reportError = vi.fn();
vi.mock('../../../services/observability', () => ({
  observabilityService: { reportError: (...args: unknown[]) => reportError(...args) },
}));

import { callAiProxyDetailed } from '../../../services/ai/aiProxyClient';
import { assertDirectCallAllowed } from '../../../services/ai/aiProxyEnforcement';
import { isProxyFailure } from '../../../services/ai/aiProxyPolicy';
import { TRACE_ID_HEADER, isTraceId, newTraceId } from '../../../lib/traceId';
import type { Settings } from '../../../types';

const env = import.meta.env as Record<string, unknown>;
const request = { provider: 'gemini' as const, model: 'gemini-2.5-flash', contents: 'hola' };

const settings = { aiConfig: { apiKeySource: 'global', provider: 'gemini' } } as Settings;

const headersOf = (call: unknown[]): Record<string, string> =>
  (call[1] as { headers: Record<string, string> }).headers;

beforeEach(() => {
  vi.restoreAllMocks();
  reportError.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  env.VITE_AI_PROXY_URL = 'https://arky.example/api/ai';
  delete env.VITE_AI_STRICT_PROXY;
  localStorage.clear();
});

afterEach(() => {
  delete env.VITE_AI_PROXY_URL;
  delete env.VITE_AI_STRICT_PROXY;
});

describe('the browser sends a trace id with every proxy call', () => {
  it('mints one when the caller supplies none', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await callAiProxyDetailed(request);

    const sent = headersOf(fetchMock.mock.calls[0])[TRACE_ID_HEADER];
    expect(isTraceId(sent)).toBe(true);
  });

  it('uses the caller’s id, so one user action traces as one id across calls', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ text: 'ok' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const traceId = newTraceId('artifact-generation');

    await callAiProxyDetailed({ ...request, traceId });

    expect(headersOf(fetchMock.mock.calls[0])[TRACE_ID_HEADER]).toBe(traceId);
  });
});

describe('a failure reports the id it was sent under', () => {
  it('carries it on a rejected call', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('rate limited', { status: 429 })));
    const traceId = newTraceId('artifact-generation');

    const outcome = await callAiProxyDetailed({ ...request, traceId });

    expect(isProxyFailure(outcome)).toBe(true);
    if (isProxyFailure(outcome)) expect(outcome.traceId).toBe(traceId);
  });

  it('carries it when the proxy is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const traceId = newTraceId('artifact-generation');

    const outcome = await callAiProxyDetailed({ ...request, traceId });

    if (isProxyFailure(outcome)) expect(outcome.traceId).toBe(traceId);
    else throw new Error('expected a failure');
  });

  it('carries one even when the proxy was never configured', async () => {
    delete env.VITE_AI_PROXY_URL;
    const outcome = await callAiProxyDetailed(request);
    if (isProxyFailure(outcome)) expect(isTraceId(outcome.traceId)).toBe(true);
    else throw new Error('expected a failure');
  });
});

describe('the recorded event carries the same id', () => {
  it('puts the trace id on the observability event for a blocked call', async () => {
    env.VITE_AI_STRICT_PROXY = 'true';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 503 })));
    const traceId = newTraceId('artifact-generation');

    const outcome = await callAiProxyDetailed({ ...request, traceId });
    if (!isProxyFailure(outcome)) throw new Error('expected a failure');

    expect(() => assertDirectCallAllowed(settings, outcome)).toThrow();

    const [, input] = reportError.mock.calls[0] as [unknown, Record<string, unknown>];
    // Both places: the field the UI reads, and the metadata a log search hits.
    expect(input.traceId).toBe(traceId);
    expect((input.metadata as Record<string, unknown>).traceId).toBe(traceId);
  });
});

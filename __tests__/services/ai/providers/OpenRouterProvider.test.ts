/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterProvider } from '../../../../services/ai/providers/openrouter/OpenRouterProvider';
import { collectStream } from '../../../../services/ai/core/AIStream';
import { AIError } from '../../../../services/ai/core/AIError';
import type { Settings } from '../../../../types';

const settings = (apiKeySource: 'user' | 'global' = 'global'): Settings => ({
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model: 'openrouter/auto',
    temperature: 0.2,
    tone: 'Consiso',
    languageStyle: 'Directo',
    apiKeySource,
  },
});

function okJson(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('OpenRouterProvider', () => {
  it('exposes id/name/capabilities', () => {
    const p = new OpenRouterProvider({ settings: settings() });
    expect(p.id).toBe('openrouter');
    expect(p.name).toBe('OpenRouter');
    expect(p.capabilities).toEqual({
      streaming: true,
      structuredOutput: true,
      tools: true,
      // This adapter sends text only, so it declares what it implements rather
      // than what OpenRouter's catalogue can do.
      images: false,
      files: false,
      audio: false,
    });
  });

  it('generateText posts to /chat/completions with Bearer and returns text', async () => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'sk-or-test');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okJson({ choices: [{ message: { content: 'Hola OpenRouter' } }], usage: { total_tokens: 7 } }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const p = new OpenRouterProvider({ settings: settings() });
    const res = await p.generateText({ purpose: 'test', prompt: 'di hola' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    expect(String(url)).toContain('chat/completions');
    const headers = opts.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk-or-test');

    const sentBody = JSON.parse(String(opts.body)) as Record<string, unknown>;
    expect(sentBody.model).toBe('openrouter/auto');
    expect(sentBody.messages).toEqual([{ role: 'user', content: 'di hola' }]);
    expect(sentBody.stream).toBe(false);

    expect(res.text).toBe('Hola OpenRouter');
    expect(res.usage.totalTokens).toBe(7);
    expect(res.trace.provider).toBe('openrouter');
    expect(res.trace.modelEffective).toBe('openrouter/auto');
    expect(res.trace.status).toBe('success');
  });

  it('generateStructured puts the schema on the wire and parses the payload', async () => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'sk-or-test');
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okJson({ choices: [{ message: { content: '{"score": 9, "ok": true}' } }] }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const p = new OpenRouterProvider({ settings: settings() });
    const res = await p.generateStructured<{ score: number; ok: boolean }>(
      { purpose: 'test', prompt: 'rate it', responseFormat: 'json' },
      { type: 'object', properties: { score: { type: 'number' } } },
    );

    expect(res.structured).toEqual({ score: 9, ok: true });
    const [, opts] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const sentBody = JSON.parse(String(opts.body)) as Record<string, unknown>;
    // The schema is carried as a schema, translated into the strict
    // `json_schema` envelope — not downgraded to bare `json_object`, which
    // would constrain the syntax and silently drop the requested shape.
    expect(sentBody.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: {
        strict: true,
        schema: { type: 'object', properties: { score: { type: 'number' } } },
      },
    });
    expect(res.trace.structuredOutput).toBe(true);
  });

  it('streamText adapts SSE deltas through toAITextStream', async () => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', 'sk-or-test');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sseBody([JSON.stringify({ choices: [{ delta: { content: 'Hola ' } }] }), JSON.stringify({ choices: [{ delta: { content: 'OpenRouter' } }] })]), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const p = new OpenRouterProvider({ settings: settings() });
    const stream = await p.streamText({ purpose: 'test', prompt: 'saluda' });

    expect(await collectStream(stream)).toBe('Hola OpenRouter');
    const [, opts] = fetchMock.mock.calls[0] as [RequestInfo | URL, RequestInit];
    const sentBody = JSON.parse(String(opts.body)) as Record<string, unknown>;
    expect(sentBody.stream).toBe(true);
  });

  it('generateText throws a configuration AIError when no API key resolves', async () => {
    vi.stubEnv('VITE_OPENROUTER_API_KEY', '');
    localStorage.clear();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const p = new OpenRouterProvider({ settings: settings('global') });
    await expect(p.generateText({ purpose: 'test', prompt: 'x' })).rejects.toMatchObject({
      category: 'configuration',
      errorCode: 'missing_api_key',
      provider: 'openrouter',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifyError delegates to the OpenRouter classifier', () => {
    const p = new OpenRouterProvider({ settings: settings() });
    expect(p.classifyError({ status: 429, message: 'rate limit' })).toBeInstanceOf(AIError);
    expect(p.classifyError({ status: 429, message: 'rate limit' }).category).toBe('rate-limit');
    expect(p.classifyError({ status: 401, message: 'unauthorized' }).category).toBe('auth');
  });
});

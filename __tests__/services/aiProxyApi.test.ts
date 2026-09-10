/**
 * Specs for the provider-agnostic serverless proxy (`api/ai.ts`).
 *
 * Covers the two provider branches (Gemini SDK vs OpenRouter `fetch`), the
 * structured-output translation, the shared rate-limit envelope and the
 * missing-key path.
 */

import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { __test__ as aiProxyTest } from '../../api/ai';

const generateContentMock = vi.fn();
const generateContentStreamMock = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAIMock() {
    return { models: { generateContent: generateContentMock, generateContentStream: generateContentStreamMock } };
  }),
}));

// The handlers now authenticate before spending a key. These specs exercise the
// generation behaviour, so the verifier is stubbed to a known caller; the
// authentication contract itself has its own spec
// (`__tests__/services/proxyAuthentication.test.ts`).
vi.mock('../../api/_shared/authenticateProxyCaller', () => ({
  authenticateProxyCaller: vi.fn(async () => ({ allowed: true, uid: 'uid-under-test' })),
}));

type JsonBody = Record<string, unknown>;

type MockResponse = ServerResponse & {
  statusCodeValue?: number;
  jsonBody?: JsonBody;
  headersMap: Map<string, string>;
  sseText?: string;
  status: (code: number) => MockResponse;
  json: (body: JsonBody) => void;
};

const createRequest = (body: JsonBody, headers: Record<string, string> = {}): IncomingMessage => {
  const stream = Readable.from([JSON.stringify(body)]) as IncomingMessage & {
    method?: string;
    headers: Record<string, string>;
  };
  stream.method = 'POST';
  stream.headers = headers;
  Object.defineProperty(stream, 'socket', { value: { remoteAddress: '127.0.0.1' } });
  return stream;
};

const createResponse = (): MockResponse => {
  const headersMap = new Map<string, string>();
  const mock = {
    statusCodeValue: 0,
    jsonBody: undefined as JsonBody | undefined,
    sseText: '',
    headersMap,
    setHeader(name: string, value: number | string | readonly string[]) {
      headersMap.set(name, Array.isArray(value) ? value.join(',') : String(value));
      return mock as unknown as MockResponse;
    },
    status(code: number) {
      mock.statusCodeValue = code;
      return mock as unknown as MockResponse;
    },
    json(body: JsonBody) {
      mock.jsonBody = body;
    },
    write(chunk: string | Uint8Array) {
      mock.sseText += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
      return true;
    },
    end() {
      return mock as unknown as MockResponse;
    },
  };
  return mock as unknown as MockResponse;
};

describe('api/ai proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateContentMock.mockReset();
    generateContentStreamMock.mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    aiProxyTest.resetRateLimitBuckets();
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key';
    delete process.env.AI_PROXY_MAX_REQUESTS_PER_WINDOW;
  });

  it('routes to Gemini and forwards the structured-output config', async () => {
    generateContentMock.mockResolvedValue({ text: '{"ok":true}' });

    const response = createResponse();
    await handler(
      createRequest({
        provider: 'gemini',
        model: 'gemini-2.5-flash',
        contents: 'hola',
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT' },
      }, { 'x-arky-session-id': 's1' }),
      response,
    );

    expect(response.statusCodeValue).toBe(200);
    expect(response.jsonBody).toMatchObject({ text: '{"ok":true}', provider: 'gemini', model: 'gemini-2.5-flash' });
    expect(generateContentMock).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gemini-2.5-flash',
      contents: 'hola',
      config: expect.objectContaining({
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT' },
      }),
    }));
  });

  it('routes to OpenRouter and carries the schema through as a schema', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: 'salida' } }] }), { status: 200 }),
    );

    const response = createResponse();
    await handler(
      createRequest({
        provider: 'openrouter',
        model: 'openrouter/deepseek/deepseek-chat',
        contents: 'hola',
        systemInstruction: 'eres un arquitecto',
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT' },
      }, { 'x-arky-session-id': 's2' }),
      response,
    );

    expect(response.statusCodeValue).toBe(200);
    expect(response.jsonBody).toMatchObject({ text: 'salida', provider: 'openrouter' });
    expect(generateContentMock).not.toHaveBeenCalled();

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(init.body as string);
    expect(payload).toMatchObject({
      model: 'openrouter/deepseek/deepseek-chat',
      response_format: {
        type: 'json_schema',
        json_schema: { strict: true, schema: { type: 'object' } },
      },
    });
    // The schema travels inside `response_format`, translated into OpenRouter's
    // dialect. The raw Gemini-shaped field must never leak onto the wire.
    expect(payload.responseSchema).toBeUndefined();
    expect(payload.messages).toEqual([
      { role: 'system', content: 'eres un arquitecto' },
      { role: 'user', content: 'hola' },
    ]);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer openrouter-test-key');
  });

  it('reports a missing key for the selected provider only', async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.VITE_OPENROUTER_API_KEY;

    const response = createResponse();
    await handler(createRequest({ provider: 'openrouter', contents: 'hola' }, { 'x-arky-session-id': 's3' }), response);

    expect(response.statusCodeValue).toBe(500);
    expect(response.jsonBody).toMatchObject({
      error: 'missing_provider_api_key',
      source: 'proxy',
      provider: 'openrouter',
    });
  });

  it('surfaces provider rate limits distinctly from proxy-local ones', async () => {
    generateContentMock.mockRejectedValue({ status: 429, retryAfter: 30 });

    const providerLimited = createResponse();
    await handler(createRequest({ provider: 'gemini', contents: 'hola' }, { 'x-arky-session-id': 's4' }), providerLimited);
    expect(providerLimited.jsonBody).toMatchObject({
      error: 'provider_rate_limited',
      source: 'gemini',
      retryAfterMs: 30_000,
    });

    process.env.AI_PROXY_MAX_REQUESTS_PER_WINDOW = '1';
    aiProxyTest.resetRateLimitBuckets();
    generateContentMock.mockResolvedValue({ text: 'ok' });

    const first = createResponse();
    await handler(createRequest({ contents: 'hola' }, { 'x-arky-session-id': 's5' }), first);
    const second = createResponse();
    await handler(createRequest({ contents: 'hola' }, { 'x-arky-session-id': 's5' }), second);

    expect(first.statusCodeValue).toBe(200);
    expect(second.statusCodeValue).toBe(429);
    expect(second.jsonBody).toMatchObject({ error: 'proxy_rate_limited', source: 'proxy' });
    expect(second.headersMap.get('Retry-After')).toEqual(expect.any(String));
  });

  it('rejects non-POST methods', async () => {
    const request = createRequest({}, {}) as IncomingMessage & { method?: string };
    request.method = 'GET';

    const response = createResponse();
    await handler(request, response);

    expect(response.statusCodeValue).toBe(405);
    expect(response.jsonBody).toMatchObject({ error: 'method_not_allowed' });
  });

  it('flattens Gemini Content[] into a prompt for OpenRouter', () => {
      expect(aiProxyTest.contentsToPrompt([
        { role: 'user', parts: [{ text: 'linea 1' }, { text: 'linea 2' }] },
        { text: 'linea 3' },
      ])).toBe('linea 1\nlinea 2\nlinea 3');
      expect(aiProxyTest.contentsToPrompt('plano')).toBe('plano');
    });

    it('streams Gemini deltas as SSE when stream is requested', async () => {
      generateContentStreamMock.mockResolvedValue(
        (async function* () {
          yield { text: 'hola ' };
          yield { text: 'mundo' };
        })(),
      );

      const response = createResponse();
      await handler(
        createRequest({
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          contents: 'cuéntame',
          stream: true,
        }, { 'x-arky-session-id': 's6' }),
        response,
      );

      expect(response.statusCodeValue).toBe(200);
      expect(response.headersMap.get('Content-Type')).toContain('text/event-stream');
      const sse = response.sseText ?? '';
      expect(sse).toContain('data: {"text":"hola "}');
      expect(sse).toContain('data: {"text":"mundo"}');
      expect(sse).toContain('data: [DONE]');
      // Non-streaming path must not have been used.
      expect(generateContentMock).not.toHaveBeenCalled();
      expect(generateContentStreamMock).toHaveBeenCalledWith(expect.objectContaining({
        model: 'gemini-2.5-flash',
        contents: 'cuéntame',
      }));
    });

    it('streams OpenRouter deltas as SSE when stream is requested', async () => {
      const encoder = new TextEncoder();
      const upstream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hola "}}]}\n\n'));
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"mundo"}}]}\n\n'));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(upstream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
      );

      const response = createResponse();
      await handler(
        createRequest({
          provider: 'openrouter',
          model: 'openrouter/deepseek/deepseek-chat',
          contents: 'hola',
          systemInstruction: 'sé conciso',
          stream: true,
        }, { 'x-arky-session-id': 's7' }),
        response,
      );

      expect(response.statusCodeValue).toBe(200);
      const sse = response.sseText ?? '';
      expect(sse).toContain('data: {"text":"hola "}');
      expect(sse).toContain('data: {"text":"mundo"}');
      expect(sse).toContain('data: [DONE]');
      expect(generateContentStreamMock).not.toHaveBeenCalled();

      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const payload = JSON.parse(init.body as string) as { stream?: boolean; messages?: unknown[]; systemInstruction?: unknown };
      expect(payload.stream).toBe(true);
      expect(payload.systemInstruction).toBeUndefined();
      expect(payload.messages).toEqual([
        { role: 'system', content: 'sé conciso' },
        { role: 'user', content: 'hola' },
      ]);
    });

    it('reports open-errors via the JSON envelope instead of SSE for stream requests', async () => {
      generateContentStreamMock.mockRejectedValue({ status: 429, retryAfter: 20 });

      const response = createResponse();
      await handler(
        createRequest({ provider: 'gemini', contents: 'hola', stream: true }, { 'x-arky-session-id': 's8' }),
        response,
      );

      expect(response.statusCodeValue).toBe(429);
      expect(response.jsonBody).toMatchObject({ error: 'provider_rate_limited', source: 'gemini', retryAfterMs: 20_000 });
      expect(response.sseText).toBe('');
    });
  });

  describe('trace correlation with the browser', () => {
    const invoke = async (headers: Record<string, string>) => {
      generateContentMock.mockResolvedValue({ text: 'ok' });
      const response = createResponse();
      await handler(
        createRequest({ provider: 'gemini', contents: 'hola' }, { 'x-arky-session-id': 's-trace', ...headers }),
        response,
      );
      return response.jsonBody as { requestId: string };
    };

    it('adopts the client trace id so the log line and the browser event match', async () => {
      const traceId = 'artifact-generation-abc123def';
      const body = await invoke({ 'x-arky-trace-id': traceId });
      expect(body.requestId).toBe(traceId);
    });

    it('mints its own id rather than echoing a header carrying a newline', async () => {
      // The header is written by the caller and ends up in a log line;
      // echoing it unchecked is how log entries get forged.
      const hostile = 'abcdefgh\nlevel=error injected=true';
      const body = await invoke({ 'x-arky-trace-id': hostile });
      expect(body.requestId).not.toBe(hostile);
      expect(body.requestId).not.toContain('\n');
      expect(body.requestId.startsWith('aiproxy-')).toBe(true);
    });

    it('mints its own id when the client sends none', async () => {
      const body = await invoke({});
      expect(body.requestId.startsWith('aiproxy-')).toBe(true);
    });
  });


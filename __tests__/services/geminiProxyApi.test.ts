import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { __test__ as geminiProxyTest } from '../../api/gemini';

const generateContentMock = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAIMock() {
    return {
      models: {
        generateContent: generateContentMock,
      },
    };
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
  status: (code: number) => MockResponse;
  json: (body: JsonBody) => void;
};

const createRequest = (body: JsonBody, headers: Record<string, string> = {}): IncomingMessage => {
  const stream = Readable.from([JSON.stringify(body)]) as IncomingMessage & { method?: string; headers: Record<string, string>; socket: { remoteAddress?: string } };
  stream.method = 'POST';
  stream.headers = headers;
  Object.defineProperty(stream, 'socket', { value: { remoteAddress: '127.0.0.1' } });
  return stream;
};

const createResponse = (): MockResponse => {
  const headersMap = new Map<string, string>();
  const response = {
    headersMap,
    setHeader(name: string, value: number | string | readonly string[]) {
      headersMap.set(name, Array.isArray(value) ? value.join(',') : String(value));
      return this as MockResponse;
    },
    status(code: number) {
      this.statusCodeValue = code;
      return this as MockResponse;
    },
    json(body: JsonBody) {
      this.jsonBody = body;
    },
  } as MockResponse;
  return response;
};

const payload = {
  model: 'gemini-2.5-flash',
  systemInstruction: 'system',
  contents: [{ role: 'user', parts: [{ text: 'hola' }] }],
  temperature: 0.2,
};

describe('api/gemini proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    geminiProxyTest.resetRateLimitBuckets();
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.GEMINI_PROXY_MAX_REQUESTS_PER_WINDOW;
  });

  it('distinguishes proxy-local rate limits from provider limits', async () => {
    process.env.GEMINI_PROXY_MAX_REQUESTS_PER_WINDOW = '1';
    generateContentMock.mockResolvedValue({ text: 'ok' });

    const firstResponse = createResponse();
    await handler(createRequest(payload, { 'x-arky-session-id': 'session-a' }), firstResponse);
    expect(firstResponse.statusCodeValue).toBe(200);

    const secondResponse = createResponse();
    await handler(createRequest(payload, { 'x-arky-session-id': 'session-a' }), secondResponse);

    expect(secondResponse.statusCodeValue).toBe(429);
    expect(secondResponse.jsonBody).toMatchObject({
      error: 'proxy_rate_limited',
      source: 'proxy',
    });
    expect(secondResponse.jsonBody?.retryAfterMs).toEqual(expect.any(Number));
    expect(secondResponse.headersMap.get('Retry-After')).toEqual(expect.any(String));
  });

  it('returns provider_rate_limited when Gemini returns 429', async () => {
    generateContentMock.mockRejectedValue({ status: 429, message: 'quota', retryAfter: 30 });

    const response = createResponse();
    await handler(createRequest(payload, { 'x-arky-session-id': 'session-b' }), response);

    expect(response.statusCodeValue).toBe(429);
    expect(response.jsonBody).toMatchObject({
      error: 'provider_rate_limited',
      source: 'gemini',
      retryAfterMs: 30_000,
    });
  });

  it('returns a structured missing_gemini_api_key response', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.VITE_GEMINI_API_KEY;

    const response = createResponse();
    await handler(createRequest(payload, { 'x-arky-session-id': 'session-c' }), response);

    expect(response.statusCodeValue).toBe(500);
    expect(response.jsonBody).toMatchObject({
      error: 'missing_gemini_api_key',
      source: 'proxy',
    });
  });

  it('budgets against the verified caller, not a header they can rotate', async () => {
    // The defect this replaces: the bucket key came from `x-arky-session-id`,
    // which the caller writes. Rotating it per request yielded unlimited fresh
    // buckets. A verified uid now wins over the header, so changing the header
    // no longer buys a second allowance.
    process.env.GEMINI_PROXY_MAX_REQUESTS_PER_WINDOW = '1';
    generateContentMock.mockResolvedValue({ text: 'ok' });

    const firstResponse = createResponse();
    await handler(
      createRequest(payload, { 'x-forwarded-for': '10.0.0.1', 'x-arky-session-id': 'session-one' }),
      firstResponse,
    );
    const secondResponse = createResponse();
    await handler(
      createRequest(payload, { 'x-forwarded-for': '10.0.0.1', 'x-arky-session-id': 'session-two' }),
      secondResponse,
    );

    expect(firstResponse.statusCodeValue).toBe(200);
    expect(secondResponse.statusCodeValue).toBe(429);
  });
});

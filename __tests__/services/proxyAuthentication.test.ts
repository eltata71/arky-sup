/**
 * The AI proxy holds the operator's provider keys. Before this work it spent
 * them for anyone who asked: no caller authentication, and a rate limit keyed
 * on a header the caller writes.
 *
 * These specs pin the closed door. The headline assertion is the plainest one —
 * a request with no token gets 401 — and the rest cover the ways a token can be
 * wrong, because "we check the token" is only worth as much as what it checks.
 */

import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const generateContentMock = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function GoogleGenAIMock() {
    return { models: { generateContent: generateContentMock } };
  }),
}));

import handler from '../../api/ai';
import {
  allowsUnauthenticated,
  readBearerToken,
  resetJwksCache,
  verifyIdToken,
} from '../../api/_shared/verifyIdToken';
import { getClientId, isModelAllowed, resetRateLimitBuckets } from '../../api/_shared/proxyRuntime';

type JsonBody = Record<string, unknown>;

type MockResponse = ServerResponse & {
  statusCodeValue?: number;
  jsonBody?: JsonBody;
  headersMap: Map<string, string>;
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
  const res: MockResponse = {
    headersMap: new Map<string, string>(),
    setHeader(this: MockResponse, name: string, value: string) {
      this.headersMap.set(name.toLowerCase(), value);
      return this;
    },
    status(this: MockResponse, code: number) {
      this.statusCodeValue = code;
      return this;
    },
    json(this: MockResponse, body: JsonBody) {
      this.jsonBody = body;
    },
  } as unknown as MockResponse;
  return res;
};

/** A syntactically valid JWT whose signature is nonsense. */
const forgedToken = (payload: Record<string, unknown>): string => {
  const b64 = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${b64({ alg: 'RS256', kid: 'forged-kid' })}.${b64(payload)}.${Buffer.from('not-a-signature').toString('base64url')}`;
};

const PAYLOAD = { provider: 'gemini', model: 'gemini-2.5-flash', contents: 'hola' };

beforeEach(() => {
  resetRateLimitBuckets();
  resetJwksCache();
  generateContentMock.mockReset();
  generateContentMock.mockResolvedValue({ text: 'ok' });
  process.env.GEMINI_API_KEY = 'server-key';
  process.env.FIREBASE_PROJECT_ID = 'arky-test';
  delete process.env.AI_PROXY_ALLOW_UNAUTHENTICATED;
  delete process.env.AI_PROXY_ALLOWED_MODELS;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.AI_PROXY_ALLOW_UNAUTHENTICATED;
  delete process.env.AI_PROXY_ALLOWED_MODELS;
});

describe('the proxy refuses to spend a key for an unidentified caller', () => {
  it('answers 401 when no token is presented', async () => {
    const response = createResponse();
    await handler(createRequest(PAYLOAD), response);

    expect(response.statusCodeValue).toBe(401);
    expect(response.jsonBody).toMatchObject({ error: 'unauthenticated' });
  });

  it('never reaches the provider when the caller is unauthenticated', async () => {
    // The assertion that matters commercially: no token, no spend.
    await handler(createRequest(PAYLOAD), createResponse());
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('rejects a bare uid header — the identity it used to trust', async () => {
    const response = createResponse();
    await handler(createRequest(PAYLOAD, { 'x-arky-user-id': 'someone-elses-uid' }), response);

    expect(response.statusCodeValue).toBe(401);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('rejects a forged token whose signature does not verify', async () => {
    const response = createResponse();
    await handler(
      createRequest(PAYLOAD, {
        authorization: `Bearer ${forgedToken({
          aud: 'arky-test',
          iss: 'https://securetoken.google.com/arky-test',
          sub: 'attacker',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
        })}`,
      }),
      response,
    );

    expect(response.statusCodeValue).toBe(401);
    expect(generateContentMock).not.toHaveBeenCalled();
  });

  it('refuses to run at all when the project id is not configured', async () => {
    // Failing closed is safe: the client treats any proxy failure as "use the
    // direct path", so this degrades rather than breaking the feature.
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.VITE_FIREBASE_PROJECT_ID;

    const response = createResponse();
    await handler(createRequest(PAYLOAD), response);

    expect(response.statusCodeValue).toBe(401);
    expect(response.jsonBody).toMatchObject({ reason: 'proxy_missing_project_id' });
  });
});

describe('the explicit unauthenticated escape hatch', () => {
  it('lets a request through only when the operator opted in by name', async () => {
    process.env.AI_PROXY_ALLOW_UNAUTHENTICATED = 'true';

    const response = createResponse();
    await handler(createRequest(PAYLOAD), response);

    expect(response.statusCodeValue).toBe(200);
    expect(generateContentMock).toHaveBeenCalled();
  });

  it('is off unless the value is exactly true', async () => {
    process.env.AI_PROXY_ALLOW_UNAUTHENTICATED = 'yes';
    expect(allowsUnauthenticated()).toBe(false);

    const response = createResponse();
    await handler(createRequest(PAYLOAD), response);
    expect(response.statusCodeValue).toBe(401);
  });
});

describe('verifyIdToken', () => {
  it('reports a missing project id rather than accepting anything', async () => {
    delete process.env.FIREBASE_PROJECT_ID;
    delete process.env.VITE_FIREBASE_PROJECT_ID;
    const outcome = await verifyIdToken('a.b.c');
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('proxy_missing_project_id');
  });

  it('rejects a token that is not three segments', async () => {
    const outcome = await verifyIdToken('not-a-jwt');
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('malformed_token');
  });

  it('rejects an algorithm other than RS256, including "none"', async () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const token = `${b64({ alg: 'none' })}.${b64({ sub: 'x' })}.`;
    const outcome = await verifyIdToken(token);
    expect(outcome.ok).toBe(false);
    // `alg: none` is the classic JWT bypass; it must never reach claim checks.
    expect(['unexpected_algorithm', 'malformed_token']).toContain(outcome.reason);
  });

  it('rejects a token with no key id, since no key could be selected', async () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const token = `${b64({ alg: 'RS256' })}.${b64({ sub: 'x' })}.sig`;
    const outcome = await verifyIdToken(token);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('missing_key_id');
  });

  it('does not accept a token just because the claims look right', async () => {
    // Signature first: reading `sub` off an unverified token is how a
    // "verified uid" ends up being whatever the caller typed.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ keys: [{ kid: 'forged-kid', kty: 'RSA', n: 'AQAB', e: 'AQAB' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const outcome = await verifyIdToken(
      forgedToken({
        aud: 'arky-test',
        iss: 'https://securetoken.google.com/arky-test',
        sub: 'attacker',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
      }),
    );

    expect(outcome.ok).toBe(false);
    expect(['invalid_signature', 'signature_check_failed']).toContain(outcome.reason);
  });

  it('reports unavailable signing keys instead of letting the call through', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 500 }));
    const outcome = await verifyIdToken(forgedToken({ sub: 'x' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('signing_keys_unavailable');
  });
});

describe('readBearerToken', () => {
  const withHeader = (value?: string) =>
    ({ headers: value === undefined ? {} : { authorization: value } }) as unknown as IncomingMessage;

  it('reads a well-formed bearer header', () => {
    expect(readBearerToken(withHeader('Bearer abc.def.ghi'))).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the scheme', () => {
    expect(readBearerToken(withHeader('bearer abc'))).toBe('abc');
  });

  it('returns nothing for a missing, empty or non-bearer header', () => {
    expect(readBearerToken(withHeader())).toBeUndefined();
    expect(readBearerToken(withHeader('Bearer   '))).toBeUndefined();
    expect(readBearerToken(withHeader('Basic abc'))).toBeUndefined();
  });
});

describe('rate-limit identity', () => {
  const req = (headers: Record<string, string>) =>
    ({ headers, socket: { remoteAddress: '10.0.0.1' } }) as unknown as IncomingMessage;

  it('keys on the verified uid when there is one', () => {
    expect(getClientId(req({ 'x-arky-session-id': 'rotating' }), 'uid-7')).toBe('uid:uid-7');
  });

  it('ignores the session header entirely once a uid is verified', () => {
    const a = getClientId(req({ 'x-arky-session-id': 'one' }), 'uid-7');
    const b = getClientId(req({ 'x-arky-session-id': 'two' }), 'uid-7');
    expect(a).toBe(b);
  });

  it('falls back to the session header only when unauthenticated', () => {
    expect(getClientId(req({ 'x-arky-session-id': 'sess-1' }))).toBe('session:sess-1');
  });
});

describe('model allow-list', () => {
  it('permits everything when unset, so existing deployments keep working', () => {
    expect(isModelAllowed('anything/at-all')).toBe(true);
  });

  it('permits only the listed models once configured', () => {
    process.env.AI_PROXY_ALLOWED_MODELS = 'gemini-2.5-flash, openrouter/auto';
    expect(isModelAllowed('gemini-2.5-flash')).toBe(true);
    expect(isModelAllowed('openrouter/auto')).toBe(true);
    expect(isModelAllowed('anthropic/claude-opus-4')).toBe(false);
  });

  it('answers 403 for a model outside the list', async () => {
    process.env.AI_PROXY_ALLOW_UNAUTHENTICATED = 'true';
    process.env.AI_PROXY_ALLOWED_MODELS = 'gemini-2.5-flash-lite';

    const response = createResponse();
    await handler(createRequest({ ...PAYLOAD, model: 'gemini-2.5-pro' }), response);

    expect(response.statusCodeValue).toBe(403);
    expect(response.jsonBody).toMatchObject({ error: 'model_not_allowed' });
    expect(generateContentMock).not.toHaveBeenCalled();
  });
});

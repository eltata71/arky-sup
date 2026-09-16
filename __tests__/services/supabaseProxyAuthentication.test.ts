import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticateProxyCaller } from '../../api/_shared/authenticateProxyCaller';
import { readTokenIssuer } from '../../api/_shared/verifySupabaseToken';

const url = 'https://pilot.supabase.co';
// Unit-test fixture only; never sent to a live service.
const token = (issuer = `${url}/auth/v1`) => [
  { alg: 'ES256', kid: 'unit-key' }, { iss: issuer, sub: 'untrusted-subject' },
].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.unit-signature';
const request = (jwt?: string): IncomingMessage => {
  const req = Readable.from([]) as IncomingMessage;
  req.headers = jwt ? { authorization: `Bearer ${jwt}` } : {};
  return req;
};

beforeEach(() => {
  vi.stubEnv('AI_PROXY_ALLOW_UNAUTHENTICATED', '');
  vi.stubEnv('FIREBASE_PROJECT_ID', '');
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', '');
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'unit-publishable-key');
  vi.stubEnv('SUPABASE_PILOT_EMAILS', ' Pilot@Example.com ');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Supabase proxy caller verification', () => {
  it('uses the Auth server identity, never an unverified JWT subject', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'verified-user-id', role: 'authenticated', email: 'pilot@example.com', is_anonymous: false,
    })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: true, uid: 'supabase:verified-user-id',
    });
    expect(fetchMock).toHaveBeenCalledWith(`${url}/auth/v1/user`, expect.objectContaining({
      headers: { apikey: 'unit-publishable-key', Authorization: `Bearer ${token()}` },
      redirect: 'error',
    }));
  });

  it('rejects a token the Auth server does not recognize', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('invalid', { status: 401 })));
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'verification_failed',
    });
  });

  it('fails closed when the Auth server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'verification_failed',
    });
  });

  it('rejects a verified Supabase user outside the server pilot cohort', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'outside-id', role: 'authenticated', email: 'outside@example.com', is_anonymous: false,
    }))));
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'pilot_cohort_required',
    });
  });

  it('fails closed when the server pilot cohort is not configured', async () => {
    vi.stubEnv('SUPABASE_PILOT_EMAILS', '');
    vi.stubEnv('VITE_SUPABASE_PILOT_EMAILS', '');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'unconfigured-id', role: 'authenticated', email: 'pilot@example.com', is_anonymous: false,
    }))));
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'pilot_cohort_required',
    });
  });

  it('rejects anonymous Supabase sessions, which carry no pilot email', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'anon-id', role: 'authenticated', is_anonymous: true,
    }))));
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'anonymous_caller',
    });
  });

  it('routes non-Supabase issuers to the Firebase verifier, not getUser', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await authenticateProxyCaller(request(token('https://securetoken.google.com/other')));
    expect(outcome.allowed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalledWith(
      `${url}/auth/v1/user`, expect.anything(),
    );
  });
});

describe('readTokenIssuer', () => {
  it('reads the iss claim as a routing hint', () => {
    expect(readTokenIssuer(token())).toBe(`${url}/auth/v1`);
  });

  it('returns undefined for malformed tokens', () => {
    expect(readTokenIssuer('not-a-jwt')).toBeUndefined();
    expect(readTokenIssuer('a.b')).toBeUndefined();
  });
});

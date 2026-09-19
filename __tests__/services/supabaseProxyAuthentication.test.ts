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

/** La respuesta de `api.load_own_profile` para una identidad con cuenta. */
const activeProfile = () => new Response(JSON.stringify({
  uid: 'verified-user-id', email: 'pilot@example.com', role: 'architect', status: 'active',
}));

/** Encamina las dos llamadas que hace el verificador: identidad y cuenta. */
const backend = (user: unknown, profile: () => Response = activeProfile) => vi.fn(
  async (input: string) => (String(input).includes('/auth/v1/user')
    ? new Response(JSON.stringify(user))
    : profile()),
);

beforeEach(() => {
  vi.stubEnv('AI_PROXY_ALLOW_UNAUTHENTICATED', '');
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'unit-publishable-key');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Supabase proxy caller verification', () => {
  it('uses the Auth server identity, never an unverified JWT subject', async () => {
    const fetchMock = backend({
      id: 'verified-user-id', role: 'authenticated', email: 'pilot@example.com', is_anonymous: false,
    });
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
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid', { status: 401 })));
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'verification_failed',
    });
  });

  it('fails closed when the Auth server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'verification_failed',
    });
  });

  it('rejects an authenticated identity that has no provisioned account', async () => {
    // Autenticar no es existir. La lista de correos del piloto hacía este
    // trabajo mientras Firebase seguía siendo el proveedor principal; con
    // Supabase como único proveedor, una lista habría significado «sólo estos
    // de entre los que ya tienen cuenta» — una segunda autorización mantenida a
    // mano y condenada a quedarse vieja. Se le pregunta a la base de datos.
    vi.stubGlobal('fetch', backend(
      { id: 'no-account-id', role: 'authenticated', email: 'outside@example.com', is_anonymous: false },
      () => new Response('null'),
    ));
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'account_required',
    });
  });

  it('rejects when the account lookup itself fails, rather than assuming access', async () => {
    vi.stubGlobal('fetch', backend(
      { id: 'verified-user-id', role: 'authenticated', email: 'pilot@example.com', is_anonymous: false },
      () => new Response('denied', { status: 403 }),
    ));
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'account_required',
    });
  });

  it('fails closed when the backend is not configured at all', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', '');
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'proxy_missing_project_id',
    });
  });

  it('rejects anonymous Supabase sessions, which carry no account', async () => {
    vi.stubGlobal('fetch', backend({ id: 'anon-id', role: 'authenticated', is_anonymous: true }));
    expect(await authenticateProxyCaller(request(token()))).toEqual({
      allowed: false, reason: 'anonymous_caller',
    });
  });

  it('rejects a token from another issuer without spending a round trip', async () => {
    // Firebase emitía tokens con `iss: securetoken.google.com`. Ya no hay un
    // segundo verificador al que encaminarlos, y el rechazo lleva su propio
    // motivo en vez de fallar más adentro con uno genérico.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await authenticateProxyCaller(request(token('https://securetoken.google.com/other')))).toEqual({
      allowed: false, reason: 'unexpected_issuer',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honours the explicit unauthenticated escape hatch', async () => {
    vi.stubEnv('AI_PROXY_ALLOW_UNAUTHENTICATED', 'true');
    expect(await authenticateProxyCaller(request())).toEqual({ allowed: true });
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

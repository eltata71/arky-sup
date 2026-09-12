/**
 * Contrato del adaptador de identidad de Supabase (F4.1) y de la política de
 * sesión (F4.6).
 *
 * El cliente se inyecta, así que esto se prueba sin red, sin el SDK cargado y
 * sin base de datos: exactamente lo que permite la frontera entre
 * `supabaseIdentityAdapter` y `supabaseAuthClient`.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  classifySupabaseAuthError,
  createSupabaseIdentityAdapter,
  loadSupabaseAuthClient,
  loadSupabaseDataClient,
  loadIdentityPort,
  resetSupabaseAuthClientCache,
  sessionIdFromAccessToken,
  toAuthSession,
  type SupabaseAuthClientLike,
} from '../../../services/adapters';
import { BackendUnavailableError, IdentityError, isSessionUsable } from '../../../services/ports';

/** Construye un token con la forma real (tres segmentos, payload base64url). */
function tokenWith(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.firma`;
}

interface FakeOverrides {
  session?: unknown;
  getSessionError?: unknown;
  signInError?: unknown;
  signOutError?: unknown;
  resetError?: unknown;
}

function fakeClient(overrides: FakeOverrides = {}): SupabaseAuthClientLike & {
  emit: (session: unknown) => void;
  signOutCalls: number;
} {
  let listener: ((event: string, session: unknown) => void) | null = null;
  const client = {
    auth: {
      getSession: async () => ({ data: { session: overrides.session ?? null }, error: overrides.getSessionError }),
      signInWithPassword: async () => ({
        data: { session: overrides.session ?? null },
        error: overrides.signInError,
      }),
      signOut: async () => {
        client.signOutCalls += 1;
        return { error: overrides.signOutError };
      },
      resetPasswordForEmail: async () => ({ error: overrides.resetError }),
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        listener = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
    emit: (session: unknown) => listener?.('SIGNED_IN', session),
    signOutCalls: 0,
  };
  return client as unknown as SupabaseAuthClientLike & {
    emit: (session: unknown) => void;
    signOutCalls: number;
  };
}

const liveSession = {
  user: { id: 'usuario-1' },
  access_token: tokenWith({ sub: 'usuario-1', session_id: 'sesion-abc' }),
  expires_at: 1_800_000_000,
};

describe('sessionIdFromAccessToken', () => {
  it('extrae el session_id del payload', () => {
    expect(sessionIdFromAccessToken(liveSession.access_token)).toBe('sesion-abc');
  });

  it('devuelve null en vez de inventar un identificador', () => {
    expect(sessionIdFromAccessToken(undefined)).toBeNull();
    expect(sessionIdFromAccessToken('no-es-un-token')).toBeNull();
    expect(sessionIdFromAccessToken(tokenWith({ sub: 'usuario-1' }))).toBeNull();
    expect(sessionIdFromAccessToken('a.@@@.c')).toBeNull();
  });
});

describe('toAuthSession', () => {
  it('convierte el vencimiento de segundos a milisegundos', () => {
    const session = toAuthSession(liveSession);
    expect(session).toEqual({
      userId: 'usuario-1',
      sessionId: 'sesion-abc',
      expiresAtMs: 1_800_000_000_000,
      refreshExpiresAtMs: null,
    });
  });

  it('sin usuario no hay sesión que valga', () => {
    expect(toAuthSession(null)).toBeNull();
    expect(toAuthSession({ access_token: 'x' })).toBeNull();
  });
});

describe('adaptador Supabase de identidad', () => {
  it('inicia sesión y expone el uid observado', async () => {
    const adapter = createSupabaseIdentityAdapter(fakeClient({ session: liveSession }));
    const session = await adapter.signInWithPassword('a@b.invalid', 'secreta');
    expect(session.userId).toBe('usuario-1');
    expect(adapter.currentUserId()).toBe('usuario-1');
  });

  it('traduce credenciales inválidas y límite de tasa a causas distintas', async () => {
    const invalid = createSupabaseIdentityAdapter(
      fakeClient({ signInError: { status: 400, code: 'invalid_credentials' } }),
    );
    await expect(invalid.signInWithPassword('a@b.invalid', 'x')).rejects.toMatchObject({
      reason: 'invalid-credentials',
    });

    const limited = createSupabaseIdentityAdapter(fakeClient({ signInError: { status: 429 } }));
    await expect(limited.signInWithPassword('a@b.invalid', 'x')).rejects.toMatchObject({
      reason: 'rate-limited',
    });
  });

  it('no informa sesión cuando el proveedor no devuelve ninguna', async () => {
    const adapter = createSupabaseIdentityAdapter(fakeClient());
    expect(await adapter.getSession()).toBeNull();
    await expect(adapter.signInWithPassword('a@b.invalid', 'x')).rejects.toBeInstanceOf(IdentityError);
  });

  it('cierra sesión y olvida el uid', async () => {
    const client = fakeClient({ session: liveSession });
    const adapter = createSupabaseIdentityAdapter(client);
    await adapter.signInWithPassword('a@b.invalid', 'secreta');
    await adapter.signOut();
    expect(client.signOutCalls).toBe(1);
    expect(adapter.currentUserId()).toBeNull();
  });

  it('propaga los cambios de sesión y permite darse de baja', async () => {
    const client = fakeClient();
    const adapter = createSupabaseIdentityAdapter(client);
    const seen: (string | null)[] = [];
    const unsubscribe = adapter.observeUserId((userId) => seen.push(userId));
    client.emit(liveSession);
    client.emit(null);
    expect(seen).toEqual(['usuario-1', null]);
    expect(typeof unsubscribe).toBe('function');
  });

  it('dos adaptadores no comparten el uid observado', async () => {
    const first = createSupabaseIdentityAdapter(fakeClient({ session: liveSession }));
    const second = createSupabaseIdentityAdapter(fakeClient());
    await first.signInWithPassword('a@b.invalid', 'secreta');
    expect(first.currentUserId()).toBe('usuario-1');
    expect(second.currentUserId()).toBeNull();
  });

  it('clasifica el fallo del proveedor en el adaptador, no en el llamante', () => {
    expect(classifySupabaseAuthError({ status: 429 }).reason).toBe('rate-limited');
    expect(classifySupabaseAuthError({ status: 400 }).reason).toBe('invalid-credentials');
    expect(classifySupabaseAuthError(new Error('Failed to fetch')).reason).toBe('unavailable');
    expect(classifySupabaseAuthError(new Error('vaya')).reason).toBe('unexpected');
  });
});

describe('política de sesión (F4.6)', () => {
  const now = 1_000_000;

  it('una sesión vencida no sirve, con margen para el desfase de reloj', () => {
    expect(isSessionUsable({ userId: 'u', sessionId: 's', expiresAtMs: now + 60_000, refreshExpiresAtMs: null }, now)).toBe(true);
    // Vence dentro de 10 s, por debajo del margen de 30 s: no se usa.
    expect(isSessionUsable({ userId: 'u', sessionId: 's', expiresAtMs: now + 10_000, refreshExpiresAtMs: null }, now)).toBe(false);
    expect(isSessionUsable({ userId: 'u', sessionId: 's', expiresAtMs: now - 1, refreshExpiresAtMs: null }, now)).toBe(false);
  });

  it('falla cerrado sin sesión, sin usuario o sin vencimiento legible', () => {
    expect(isSessionUsable(null, now)).toBe(false);
    expect(isSessionUsable(undefined, now)).toBe(false);
    expect(isSessionUsable({ userId: '', sessionId: null, expiresAtMs: now + 60_000, refreshExpiresAtMs: null }, now)).toBe(false);
    expect(isSessionUsable({ userId: 'u', sessionId: null, expiresAtMs: NaN, refreshExpiresAtMs: null }, now)).toBe(false);
  });
});

describe('carga del cliente y selección de backend', () => {
  it('sin configuración no se construye un cliente a medias', async () => {
    resetSupabaseAuthClientCache();
    await expect(loadSupabaseAuthClient({})).rejects.toBeInstanceOf(BackendUnavailableError);
    await expect(loadSupabaseDataClient({})).rejects.toBeInstanceOf(BackendUnavailableError);
  });

  it('el backend por defecto es Firebase y `memory` no sirve identidad', async () => {
    await expect(loadIdentityPort({})).resolves.toBeDefined();
    await expect(loadIdentityPort({ VITE_BACKEND: 'memory' })).rejects.toBeInstanceOf(BackendUnavailableError);
  });
});

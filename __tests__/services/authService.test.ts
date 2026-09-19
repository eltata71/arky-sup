/**
 * `services/identity/authService` — la frontera con Supabase Auth.
 *
 * Estas pruebas cubrían la misma frontera sobre Firebase; lo que cambió es el
 * proveedor, no lo que se afirma. Siguen siendo los mismos tres hechos:
 *
 *   1. sin configuración, cada operación falla con un error **tipado** en vez
 *      de con un `TypeError` sobre un cliente nulo — que es el modo de fallo
 *      que hacía que un despliegue sin variables se leyera como un bug del
 *      producto;
 *   2. la identidad que devuelve es la estrecha del dominio (`uid`, `email`,
 *      `displayName`) y no el objeto del SDK, que es lo que permitió cambiar de
 *      proveedor sin tocar ninguna pantalla;
 *   3. cambiar la contraseña reautentica **antes**, en ese orden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Lo que el SDK devuelve: el sobre, no una excepción. */
interface Envelope { data: { session: unknown } | null; error: unknown }
const envelope = (value: Envelope): Envelope => value;

const authClient = {
  signInWithPassword: vi.fn(async (_credentials: { email: string; password: string }): Promise<Envelope> =>
    envelope({ data: { session: null }, error: null })),
  signOut: vi.fn(async () => ({})),
  resetPasswordForEmail: vi.fn(async () => ({})),
  updateUser: vi.fn(async () => ({})),
  getSession: vi.fn(async (): Promise<Envelope> => envelope({ data: { session: null }, error: null })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
};

vi.mock('../../services/adapters', () => ({
  loadSupabaseAuthClient: vi.fn(async () => ({ auth: authClient })),
}));

const CONFIGURED = {
  VITE_SUPABASE_URL: 'https://project.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

const session = (overrides: Record<string, unknown> = {}) => ({
  user: { id: 'uid-1', email: 'ada@arky.test', user_metadata: { full_name: 'Ada' } },
  access_token: 'token-1',
  ...overrides,
});

const loadModule = async () => import('../../services/identity/authService');

const setEnv = (env: Record<string, string> | null): void => {
  vi.stubGlobal('import', undefined);
  Object.assign(import.meta.env as Record<string, unknown>, {
    VITE_SUPABASE_URL: env?.VITE_SUPABASE_URL ?? '',
    VITE_SUPABASE_PUBLISHABLE_KEY: env?.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

afterEach(() => {
  setEnv(null);
});

describe('when the backend is not configured', () => {
  beforeEach(() => setEnv(null));

  it('reports unavailable instead of pretending a session exists', async () => {
    const { isAuthAvailable, currentUser } = await loadModule();
    expect(isAuthAvailable()).toBe(false);
    expect(currentUser()).toBeNull();
  });

  it('signInWithEmail fails with a typed error rather than a null dereference', async () => {
    const { AuthUnavailableError, signInWithEmail } = await loadModule();
    await expect(signInWithEmail('a@b.c', 'secret')).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it('sendPasswordReset fails with a typed error rather than a null dereference', async () => {
    const { AuthUnavailableError, sendPasswordReset } = await loadModule();
    await expect(sendPasswordReset('a@b.c')).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it('signOut is safe: there is nothing to end', async () => {
    const { signOutCurrentUser } = await loadModule();
    await expect(signOutCurrentUser()).resolves.toBeUndefined();
    expect(authClient.signOut).not.toHaveBeenCalled();
  });

  it('observeAuthState emits null once and hands back a no-op unsubscribe', async () => {
    const { observeAuthState } = await loadModule();
    const listener = vi.fn();
    const unsubscribe = observeAuthState(listener);
    expect(listener).toHaveBeenCalledWith(null);
    expect(() => unsubscribe()).not.toThrow();
  });
});

describe('when the backend is configured', () => {
  beforeEach(() => setEnv(CONFIGURED));

  it('signs in with email and returns the narrow domain identity', async () => {
    authClient.signInWithPassword.mockResolvedValueOnce({ data: { session: session() }, error: null });
    const { signInWithEmail, currentUser, currentUserId } = await loadModule();

    const user = await signInWithEmail('ada@arky.test', 'secret');

    expect(authClient.signInWithPassword).toHaveBeenCalledWith({ email: 'ada@arky.test', password: 'secret' });
    expect(user).toEqual({ uid: 'uid-1', email: 'ada@arky.test', displayName: 'Ada' });
    expect(currentUser()).toEqual(user);
    expect(currentUserId()).toBe('uid-1');
  });

  it('propagates the provider error when the credentials are refused', async () => {
    const error = Object.assign(new Error('Invalid login credentials'), { status: 400 });
    authClient.signInWithPassword.mockResolvedValueOnce({ data: null, error });
    const { signInWithEmail } = await loadModule();
    await expect(signInWithEmail('ada@arky.test', 'wrong')).rejects.toBe(error);
  });

  it('refuses a response that carries no usable session', async () => {
    authClient.signInWithPassword.mockResolvedValueOnce({ data: { session: { user: null } }, error: null });
    const { signInWithEmail } = await loadModule();
    await expect(signInWithEmail('ada@arky.test', 'secret')).rejects.toThrow(/sesión/i);
  });

  it('re-authenticates before changing a password, in that order', async () => {
    const order: string[] = [];
    authClient.signInWithPassword.mockImplementationOnce(async () => {
      order.push('reauth');
      return { data: { session: session() }, error: null };
    });
    authClient.updateUser.mockImplementationOnce(async () => {
      order.push('update');
      return {};
    });
    const { reauthenticateAndUpdatePassword } = await loadModule();

    await reauthenticateAndUpdatePassword(
      { uid: 'uid-1', email: 'ada@arky.test', displayName: 'Ada' },
      'ada@arky.test',
      'old-secret',
      'new-secret',
    );

    expect(order).toEqual(['reauth', 'update']);
  });

  it('does not change the password when re-authentication fails', async () => {
    const error = new Error('Invalid login credentials');
    authClient.signInWithPassword.mockResolvedValueOnce({ data: null, error });
    const { reauthenticateAndUpdatePassword } = await loadModule();

    await expect(reauthenticateAndUpdatePassword(
      { uid: 'uid-1', email: 'ada@arky.test', displayName: 'Ada' },
      'ada@arky.test',
      'wrong',
      'new-secret',
    )).rejects.toBe(error);
    expect(authClient.updateUser).not.toHaveBeenCalled();
  });

  it('reads the access token for the calls that leave the SDK', async () => {
    authClient.getSession.mockResolvedValueOnce({ data: { session: session() }, error: null });
    const { currentAccessToken } = await loadModule();
    expect(await currentAccessToken()).toBe('token-1');
  });

  it('returns no token rather than an empty string when there is no session', async () => {
    authClient.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    const { currentAccessToken } = await loadModule();
    expect(await currentAccessToken()).toBeNull();
  });

  it('signs out and forgets the remembered identity', async () => {
    authClient.signInWithPassword.mockResolvedValueOnce({ data: { session: session() }, error: null });
    const { signInWithEmail, signOutCurrentUser, currentUser } = await loadModule();
    await signInWithEmail('ada@arky.test', 'secret');
    await signOutCurrentUser();
    expect(authClient.signOut).toHaveBeenCalled();
    expect(currentUser()).toBeNull();
  });
});

describe('toAuthUser', () => {
  it('prefers full_name, falls back to name, and tolerates neither', async () => {
    const { toAuthUser } = await loadModule();
    expect(toAuthUser({ user: { id: 'u', email: 'e', user_metadata: { full_name: 'Full' } } })?.displayName).toBe('Full');
    expect(toAuthUser({ user: { id: 'u', email: 'e', user_metadata: { name: 'Name' } } })?.displayName).toBe('Name');
    expect(toAuthUser({ user: { id: 'u', email: 'e', user_metadata: null } })?.displayName).toBeNull();
  });

  it('returns null for a session with no usable id', async () => {
    const { toAuthUser } = await loadModule();
    expect(toAuthUser(null)).toBeNull();
    expect(toAuthUser({ user: { id: '' } })).toBeNull();
  });
});

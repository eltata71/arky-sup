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
  resetPasswordForEmail: vi.fn(async (
    _email: string,
    _options?: { redirectTo?: string },
  ): Promise<{ error?: unknown }> => ({})),
  updateUser: vi.fn(async () => ({})),
  getSession: vi.fn(async (): Promise<Envelope> => envelope({ data: { session: null }, error: null })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signInWithOAuth: vi.fn(async (_credentials: {
    provider: string;
    options?: { redirectTo?: string; queryParams?: Record<string, string> };
  }): Promise<{ error?: unknown }> => ({})),
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

  it('signInWithGoogle fails with a typed error rather than a null dereference', async () => {
    const { AuthUnavailableError, signInWithGoogle } = await loadModule();
    await expect(signInWithGoogle()).rejects.toBeInstanceOf(AuthUnavailableError);
    expect(authClient.signInWithOAuth).not.toHaveBeenCalled();
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

describe('signInWithGoogle', () => {
  beforeEach(() => {
    setEnv(CONFIGURED);
    vi.stubGlobal('window', { location: { origin: 'https://arky.test' } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('always asks Google which account to use', async () => {
    // Sin `prompt=select_account` Google reutiliza en silencio la sesión que el
    // navegador ya tenga. Quien trabaja con una cuenta personal y otra de la
    // organización no podría elegir, ni cambiar, sin cerrar sesión en Google —
    // y entraría a Arky con la que no quería sin llegar a verlo.
    const { signInWithGoogle } = await loadModule();
    await signInWithGoogle();
    expect(authClient.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: 'https://arky.test/auth',
        queryParams: { prompt: 'select_account' },
      },
    });
  });

  it('returns to the sign-in screen by default, and honours an explicit target', async () => {
    // El retorno cae en `/auth` a propósito: `detectSessionInUrl` consume el
    // fragmento y el observador de sesión decide a dónde va la persona, que es
    // el mismo camino que al restaurar una sesión. Una ruta de callback propia
    // sería una segunda copia de esa decisión.
    const { signInWithGoogle } = await loadModule();
    await signInWithGoogle('https://arky.test/invitacion');
    expect(authClient.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({ redirectTo: 'https://arky.test/invitacion' }),
    }));
  });

  it('surfaces a provider rejection instead of leaving the screen waiting', async () => {
    // El caso real: el proveedor Google no habilitado en el proyecto. Sin este
    // throw la pantalla se queda esperando una redirección que no va a ocurrir.
    authClient.signInWithOAuth.mockResolvedValueOnce({ error: new Error('provider is not enabled') });
    const { signInWithGoogle } = await loadModule();
    await expect(signInWithGoogle()).rejects.toThrow(/provider is not enabled/);
  });

  it('never resolves with a user: nobody has signed in yet', async () => {
    // Devolver una identidad aquí invitaría a la pantalla a navegar, y todavía
    // no ha entrado nadie: lo único que ocurrió es que el navegador se va.
    const { signInWithGoogle } = await loadModule();
    await expect(signInWithGoogle()).resolves.toBeUndefined();
  });
});

describe('el enlace de recuperación vuelve al despliegue desde el que se pidió', () => {
  beforeEach(() => setEnv(CONFIGURED));

  it('pasa redirectTo con el origen actual', async () => {
    // Sin esto, el enlace del correo lo construye la Site URL del proyecto. Con
    // dos despliegues vivos sobre la misma base —que es lo que había— eso
    // devuelve a la persona a la aplicación equivocada: la sesión se abre, pero
    // en una versión sin pantalla de nueva contraseña. Todo parece funcionar.
    vi.stubGlobal('window', { location: { origin: 'https://arky-sup.vercel.app' } });
    const { sendPasswordReset } = await loadModule();

    await sendPasswordReset('ada@arky.test');

    expect(authClient.resetPasswordForEmail).toHaveBeenCalledWith(
      'ada@arky.test',
      { redirectTo: 'https://arky-sup.vercel.app/auth' },
    );
    vi.unstubAllGlobals();
  });
});

describe('qué fallos de recuperación puede contar la interfaz', () => {
  it('cuenta los que valen para cualquier dirección', async () => {
    const { isRecoveryChannelFailure, AuthUnavailableError } = await loadModule();
    expect(isRecoveryChannelFailure(new AuthUnavailableError('sendPasswordReset'))).toBe(true);
    expect(isRecoveryChannelFailure(new Error('Email logins are disabled'))).toBe(true);
    expect(isRecoveryChannelFailure(new Error('Email signups are disabled'))).toBe(true);
  });

  it('calla ante cualquier otro, que sí podría depender de la dirección', async () => {
    // La confirmación genérica existe para que el formulario no pueda usarse
    // para preguntar quién tiene cuenta aquí. Esa protección se conserva.
    const { isRecoveryChannelFailure } = await loadModule();
    expect(isRecoveryChannelFailure(new Error('User not found'))).toBe(false);
    expect(isRecoveryChannelFailure(new Error('For security purposes, you can only request this after 47 seconds'))).toBe(false);
    expect(isRecoveryChannelFailure(null)).toBe(false);
  });
});

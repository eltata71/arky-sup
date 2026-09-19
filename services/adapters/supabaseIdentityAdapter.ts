/**
 * Adaptador Supabase Auth del `IdentityPort` (F4.1 / F4.6).
 *
 * Implementa el mismo puerto que el adaptador Firebase, así que el dominio no
 * cambia cuando cambia el proveedor. La elección vive en `identityBackend.ts`.
 *
 * Dos decisiones que conviene leer antes de tocar el fichero:
 *
 *  - **El cliente se inyecta, no se importa.** El SDK se carga de forma perezosa
 *    en `supabaseAuthClient.ts` y aquí solo se usa su forma (una interfaz
 *    estructural). Esa frontera es lo que permite probar este adaptador entero
 *    —mapeo de errores, forma de la sesión, revocación— sin red, sin base de
 *    datos y sin el SDK cargado.
 *  - **El `sessionId` sale del token, no se inventa.** Supabase Auth identifica
 *    cada sesión con un `session_id` dentro del access token; el servidor lo
 *    valida contra `auth.sessions` para revocar de verdad. Si el token no se
 *    puede leer, el id es `null` y la operación sensible falla cerrado: no se
 *    sustituye por el id del usuario, porque eso afirmaría una revocación que
 *    no se puede comprobar.
 */
import { IdentityError, type AuthSession, type IdentityPort } from '../ports';

/** Forma mínima de una sesión del SDK. Estructural a propósito. */
export interface SupabaseSessionLike {
  user?: {
    id?: string;
    email?: string | null;
    user_metadata?: { full_name?: unknown; name?: unknown } | null;
  } | null;
  access_token?: string;
  expires_at?: number | null;
  refresh_token?: string;
}

export interface SupabaseAuthResult {
  data?: { session?: SupabaseSessionLike | null } | null;
  error?: unknown;
}

/** Forma mínima del cliente de Auth que este adaptador necesita. */
export interface SupabaseAuthClientLike {
  auth: {
    getSession(): Promise<SupabaseAuthResult>;
    setSession(tokens: { access_token: string; refresh_token: string }): Promise<SupabaseAuthResult>;
    signInWithPassword(credentials: { email: string; password: string }): Promise<SupabaseAuthResult>;
    /**
     * Arranca un flujo OAuth. No devuelve sesión: el navegador se va al
     * proveedor y vuelve con la sesión en el fragmento de la URL, que
     * `detectSessionInUrl` consume y `onAuthStateChange` anuncia.
     */
    signInWithOAuth(credentials: {
      provider: string;
      options?: { redirectTo?: string; queryParams?: Record<string, string>; scopes?: string };
    }): Promise<{ error?: unknown }>;
    signOut(): Promise<{ error?: unknown }>;
    resetPasswordForEmail(email: string): Promise<{ error?: unknown }>;
    updateUser(attributes: { password: string }): Promise<{ error?: unknown }>;
    onAuthStateChange(
      callback: (event: string, session: SupabaseSessionLike | null) => void,
    ): { data?: { subscription?: { unsubscribe?: () => void } } };
  };
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Lee el `session_id` del payload del access token.
 *
 * No verifica la firma: el cliente no decide si un token vale — eso ocurre en el
 * servidor. Aquí solo se extrae el identificador de sesión para poder
 * presentarlo; un token manipulado no gana nada, porque la comprobación real la
 * hace PostgreSQL contra `auth.sessions`.
 */
export function sessionIdFromAccessToken(token: string | undefined): string | null {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || !BASE64URL.test(parts[1])) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = globalThis.atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
    const payload: unknown = JSON.parse(json);
    const claim = (payload as { session_id?: unknown })?.session_id;
    return typeof claim === 'string' && claim !== '' ? claim : null;
  } catch {
    return null;
  }
}

/** Convierte la sesión del SDK a la forma del puerto. `null` si no es utilizable. */
export function toAuthSession(session: SupabaseSessionLike | null | undefined): AuthSession | null {
  const userId = session?.user?.id;
  if (typeof userId !== 'string' || userId === '') return null;
  const expiresAtSeconds = session?.expires_at;
  return {
    userId,
    sessionId: sessionIdFromAccessToken(session?.access_token),
    expiresAtMs: typeof expiresAtSeconds === 'number' ? expiresAtSeconds * 1000 : NaN,
    refreshExpiresAtMs: null,
  };
}

/**
 * Clasifica el fallo del proveedor.
 *
 * Se clasifica aquí y no en el llamante porque clasificar es trabajo del
 * adaptador; decidir qué hacer con el fallo es de la capa de aplicación.
 */
export function classifySupabaseAuthError(error: unknown): IdentityError {
  const status = (error as { status?: unknown })?.status;
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : '';
  const message = error instanceof Error ? error.message.toLowerCase() : '';

  if (status === 429 || code === 'over_request_rate_limit' || message.includes('rate limit')) {
    return new IdentityError('rate-limited');
  }
  if (status === 400 || code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return new IdentityError('invalid-credentials');
  }
  if (message.includes('fetch') || message.includes('network')) {
    return new IdentityError('unavailable');
  }
  return new IdentityError('unexpected', error instanceof Error ? error.message : undefined);
}

export function createSupabaseIdentityAdapter(client: SupabaseAuthClientLike): IdentityPort {
  // Estado por instancia: dos adaptadores no deben pisarse el uid observado.
  let lastKnownUserId: string | null = null;

  const readSession = async (): Promise<AuthSession | null> => {
    const { data, error } = await client.auth.getSession();
    if (error) throw classifySupabaseAuthError(error);
    return toAuthSession(data?.session ?? null);
  };

  return {
    // El puerto pide lectura síncrona del uid; Supabase la ofrece asíncrona. Se
    // responde con el último valor observado; quien necesite certeza usa
    // `getSession()`.
    currentUserId: (): string | null => lastKnownUserId,

    observeUserId: (listener: (userId: string | null) => void): (() => void) => {
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        lastKnownUserId = toAuthSession(session)?.userId ?? null;
        listener(lastKnownUserId);
      });
      const unsubscribe = data?.subscription?.unsubscribe;
      return (): void => {
        if (typeof unsubscribe === 'function') unsubscribe();
      };
    },

    getSession: readSession,

    signInWithPassword: async (email: string, password: string): Promise<AuthSession> => {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw classifySupabaseAuthError(error);
      const session = toAuthSession(data?.session ?? null);
      if (!session) throw new IdentityError('unexpected', 'El proveedor no devolvió sesión.');
      lastKnownUserId = session.userId;
      return session;
    },

    signOut: async (): Promise<void> => {
      const { error } = await client.auth.signOut();
      lastKnownUserId = null;
      if (error) throw classifySupabaseAuthError(error);
    },

    requestPasswordReset: async (email: string): Promise<void> => {
      const { error } = await client.auth.resetPasswordForEmail(email);
      if (error) throw classifySupabaseAuthError(error);
    },
  };
}

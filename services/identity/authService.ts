/**
 * authService — la frontera con Supabase Auth.
 *
 * Todo SDK de esta aplicación está envuelto por un servicio, y Auth fue la
 * excepción durante mucho tiempo: `context/AuthContext.tsx` importaba quince
 * símbolos del SDK y hacía las llamadas él mismo. Eso es un contexto de React
 * sosteniendo un SDK, lo que significa que las reglas de inicio de sesión sólo
 * se pueden ejercitar montando un árbol de componentes.
 *
 * El reparto es el de siempre: este módulo habla con el proveedor, el contexto
 * traduce lo que devuelve a estado de aplicación. Aquí no se decide *política*
 * —quién puede hacer qué es `lib/authz`, y lo hace cumplir de verdad PostgreSQL
 * con sus políticas y sus RPC.
 *
 * ## Lo que cambió al retirar Firebase, y lo que se perdió a propósito
 *
 * - **El proveedor es único** (ADR-004): Supabase Auth. Sirve dos métodos de
 *   entrada —correo con contraseña y Google— y eso no son dos proveedores de
 *   identidad: las dos rutas terminan en el mismo `auth.users`, con el mismo
 *   `uid`, y sobre el mismo perfil de `api.user_profiles`. Google viaja por
 *   Supabase precisamente para que siga habiendo un solo sitio donde una cuenta
 *   existe o no existe.
 * - **El bypass de desarrollo ya no toca el backend.** Era una sesión anónima
 *   real de Firebase; ahora es una identidad en memoria y nada más, que es todo
 *   lo que necesitaba: su rol `superadmin` siempre vivió sólo en estado de
 *   React, y crear una cuenta de verdad para sostenerlo era el peor de los dos
 *   mundos.
 * - **El cliente se carga en diferido.** `loadSupabaseAuthClient` importa el SDK
 *   dinámicamente, así que Auth no entra en la carga inicial de la SPA.
 */

import { loadSupabaseAuthClient, type SupabaseAuthClientLike } from '../adapters';
import { IdentityError } from '../ports';
import { authReturnUrl } from '../../lib/authReturnUrl';

/**
 * The authenticated identity.
 *
 * Deliberadamente estrecha: la interfaz sólo depende de `uid`, `email` y
 * `displayName`. Declararla aquí —en vez de reexportar el tipo del SDK— es lo
 * que permitió cambiar de proveedor sin tocar ninguna pantalla.
 */
export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

/** Raised when a call is made while authentication is not configured. */
export class AuthUnavailableError extends Error {
  readonly code = 'auth/unavailable' as const;
  constructor(operation: string) {
    super(`La autenticación no está disponible (${operation}): falta la configuración de Supabase.`);
    this.name = 'AuthUnavailableError';
  }
}

const env = (): Record<string, string | undefined> => import.meta.env as Record<string, string | undefined>;

export function isAuthAvailable(): boolean {
  const e = env();
  return (e.VITE_SUPABASE_URL ?? '').trim() !== '' && (e.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim() !== '';
}

const requireClient = async (operation: string): Promise<SupabaseAuthClientLike> => {
  if (!isAuthAvailable()) throw new AuthUnavailableError(operation);
  return loadSupabaseAuthClient(env());
};

/**
 * La identidad de una sesión del SDK, o `null` si no es utilizable.
 *
 * `full_name` sale de `user_metadata`, que el propio usuario puede editar, así
 * que sirve para *saludar* y nunca para autorizar: el rol se lee del perfil en
 * PostgreSQL, que es lo único que las políticas consultan.
 */
export const toAuthUser = (session: { user?: { id?: string; email?: string | null; user_metadata?: { full_name?: unknown; name?: unknown } | null } | null } | null | undefined): AuthUser | null => {
  const raw = session?.user;
  if (typeof raw?.id !== 'string' || raw.id === '') return null;
  const metadata = raw.user_metadata;
  const displayName = typeof metadata?.full_name === 'string'
    ? metadata.full_name
    : typeof metadata?.name === 'string' ? metadata.name : null;
  return {
    uid: raw.id,
    email: typeof raw.email === 'string' ? raw.email : null,
    displayName,
  };
};

/**
 * La identidad en sesión ahora mismo, sin esperar a un cambio de estado.
 *
 * Es síncrona porque hay llamantes que no pueden esperar —`createDefaultReviewRepository`
 * decide si adjuntar el nivel remoto—, así que se mantiene un espejo del último
 * usuario observado. Nadie autoriza con esto: la respuesta de verdad la da el
 * servidor al recibir el token.
 */
let lastKnownUser: AuthUser | null = null;

export function currentUser(): AuthUser | null {
  return lastKnownUser;
}

/** El uid actual, o `null`. Atajo para los llamantes que sólo quieren eso. */
export function currentUserId(): string | null {
  return lastKnownUser?.uid ?? null;
}

/** Solo para pruebas y para el cierre de sesión. */
export function rememberAuthUser(user: AuthUser | null): void {
  lastKnownUser = user;
}

/**
 * Subscribe to sign-in state.
 *
 * Emite `null` y devuelve una baja inocua cuando Auth no está configurado, para
 * que el camino de limpieza del llamante sea uniforme en vez de ramificar sobre
 * la configuración.
 */
export function observeAuthState(listener: (user: AuthUser | null) => void): () => void {
  if (!isAuthAvailable()) {
    lastKnownUser = null;
    listener(null);
    return () => undefined;
  }
  let unsubscribe = (): void => undefined;
  let cancelled = false;
  void (async () => {
    try {
      const client = await loadSupabaseAuthClient(env());
      const emit = (session: unknown): void => {
        const user = toAuthUser(session as Parameters<typeof toAuthUser>[0]);
        lastKnownUser = user;
        if (!cancelled) listener(user);
      };
      const subscription = client.auth.onAuthStateChange((_event, session) => emit(session));
      const handle = subscription?.data?.subscription;
      unsubscribe = () => handle?.unsubscribe?.();
      const { data } = await client.auth.getSession();
      emit(data?.session ?? null);
    } catch {
      lastKnownUser = null;
      if (!cancelled) listener(null);
    }
  })();
  return () => {
    cancelled = true;
    unsubscribe();
  };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  const client = await requireClient('signInWithEmail');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const user = toAuthUser(data?.session ?? null);
  if (!user) throw new IdentityError('invalid-credentials', 'La sesión no se pudo establecer.');
  lastKnownUser = user;
  return user;
}

/**
 * Entrar con Google, a través de Supabase Auth.
 *
 * No devuelve nada y no puede: el navegador se va a Google y vuelve a
 * `redirectTo` con la sesión en el fragmento de la URL. Quien la recoge es el
 * SDK (`detectSessionInUrl`), y quien se entera es `observeAuthState` — el
 * mismo camino por el que se restaura una sesión al abrir la aplicación. Por
 * eso no hace falta una ruta de callback propia, y por eso una `Promise<void>`
 * que resuelve no significa que alguien haya entrado.
 *
 * `prompt=select_account` es deliberado. Sin él, Google reutiliza en silencio
 * la sesión que el navegador ya tenga, que es justo lo contrario de lo que
 * necesita quien tiene una cuenta personal y otra de trabajo: el selector le
 * deja elegir con cuál entra, y le deja cambiar sin cerrar sesión en Google.
 *
 * **Autenticar sigue sin ser tener cuenta.** Alguien con una cuenta de Google
 * que nadie ha dado de alta completa este flujo, llega sin perfil en
 * `api.user_profiles` y `AuthContext` le cierra la sesión con la explicación de
 * siempre. Que la puerta sea más cómoda no la abre a más gente: el alta la
 * sigue haciendo un administrador.
 */
export async function signInWithGoogle(redirectTo?: string): Promise<void> {
  const client = await requireClient('signInWithGoogle');
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo ?? authReturnUrl(),
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

/** Sign out. Safe to call when auth is unavailable: there is nothing to end. */
export async function signOutCurrentUser(): Promise<void> {
  lastKnownUser = null;
  if (!isAuthAvailable()) return;
  const client = await loadSupabaseAuthClient(env());
  await client.auth.signOut();
}

/**
 * ¿El envío falló por una razón que vale para **todas** las direcciones?
 *
 * La confirmación genérica del formulario de recuperación existe para que nadie
 * pueda preguntarle al producto quién tiene cuenta aquí. Esa protección sólo
 * cubre los fallos que *dependen de la dirección*; aplicarla a los demás
 * convierte una avería del despliegue en un mensaje verde, y eso ya pasó: con
 * el proveedor de correo apagado en el panel, la pantalla dijo «te enviamos un
 * enlace» tres veces seguidas mientras el servidor devolvía 400 a cada intento.
 * El fallo quedó anotado en observabilidad, que nadie estaba mirando.
 *
 * Los dos casos de aquí son propiedades del despliegue y no de quien pregunta:
 * la configuración ausente se detecta **antes** de tocar la red, y un método de
 * entrada deshabilitado responde igual para una dirección que existe y para una
 * inventada. Contarlos no revela nada. Todo lo demás sigue en silencio.
 */
export function isRecoveryChannelFailure(error: unknown): boolean {
  if (error instanceof AuthUnavailableError) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /logins are disabled|signups are disabled|email provider is disabled/i.test(message);
}

/**
 * Send a password-reset email.
 *
 * The caller resolves this the same way whether or not the address has an
 * account — that policy lives in the context, because it is about what the
 * product reveals, not about how the provider behaves.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const client = await requireClient('sendPasswordReset');
  // `redirectTo` no es opcional en la práctica: sin él el enlace del correo lo
  // construye la Site URL del proyecto, que puede apuntar a otro despliegue.
  // Ver `lib/authReturnUrl.ts` — ahí está el incidente que lo motivó.
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo: authReturnUrl(),
  });
  if (error) throw error;
}

/**
 * Re-authenticate and change the password.
 *
 * Los dos pasos juntos porque no son separables: cambiar la contraseña de una
 * sesión abierta hace rato es exactamente el caso que la reautenticación existe
 * para impedir, y exponerlos por separado invita a un llamante que sólo haga el
 * segundo.
 */
export async function reauthenticateAndUpdatePassword(
  user: AuthUser,
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const client = await requireClient('changePassword');
  const { error: reauthError } = await client.auth.signInWithPassword({ email, password: currentPassword });
  if (reauthError) throw reauthError;
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
  void user;
}

/** El token de acceso vigente, para las llamadas que salen del SDK. */
export async function currentAccessToken(): Promise<string | null> {
  if (!isAuthAvailable()) return null;
  try {
    const client = await loadSupabaseAuthClient(env());
    const { data } = await client.auth.getSession();
    const token = (data?.session as { access_token?: unknown } | null | undefined)?.access_token;
    return typeof token === 'string' && token !== '' ? token : null;
  } catch {
    return null;
  }
}

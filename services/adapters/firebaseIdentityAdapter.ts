/**
 * Adaptador Firebase del `IdentityPort` (F3.2, ampliado en F4.1).
 *
 * El dominio habla con `IdentityPort`; este fichero —junto con
 * `services/identity`— es donde ese puerto se rellena con Firebase. El adaptador
 * Supabase Auth implementa el mismo puerto, y la elección vive en
 * `identityBackend.ts`, nunca en los llamadores.
 *
 * No reexporta el SDK ni tipos de Firebase: el `uid` es `string` y la sesión es
 * lo que el puerto declara.
 *
 * Sobre la revocación (F4.6): el SDK de Firebase no expone un identificador de
 * sesión ni una forma de revocar una sesión concreta desde el cliente, así que
 * `sessionId` es `null`. Se declara así a propósito: un id inventado no sirve
 * para validar revocación en el servidor, y creer que sí lo haría es peor que
 * saber que no existe. La revocación real llega con Supabase Auth, que sí tiene
 * `auth.sessions`.
 */
import {
  currentUser,
  observeAuthState,
  sendPasswordReset,
  signInWithEmail,
  signOutCurrentUser,
} from '../identity';
import { IdentityError, type AuthSession, type IdentityPort } from '../ports';

/**
 * Vencimiento del token actual.
 *
 * Se fuerza la renovación (`getIdTokenResult`) para no reportar como vigente
 * una sesión que el SDK aún no ha refrescado. Si Firebase no está disponible,
 * `getIdTokenResult` no se puede consultar: se devuelve `null` y el puerto
 * responde «sin sesión», que es la respuesta segura.
 */
async function currentSession(): Promise<AuthSession | null> {
  const user = currentUser();
  if (!user) return null;
  try {
    const token = await user.getIdTokenResult(true);
    const expiresAtMs = Date.parse(token.expirationTime);
    return {
      userId: user.uid,
      sessionId: null,
      expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : NaN,
      refreshExpiresAtMs: null,
    };
  } catch {
    // No se pudo comprobar el token: no se afirma que la sesión valga.
    return null;
  }
}

function classify(error: unknown): IdentityError {
  const code = typeof (error as { code?: unknown })?.code === 'string'
    ? (error as { code: string }).code
    : '';
  if (code === 'auth/wrong-password' || code === 'auth/user-not-found' || code === 'auth/invalid-credential') {
    return new IdentityError('invalid-credentials');
  }
  if (code === 'auth/too-many-requests') return new IdentityError('rate-limited');
  if (code === 'auth/network-request-failed') return new IdentityError('unavailable');
  return new IdentityError('unexpected', error instanceof Error ? error.message : undefined);
}

export const firebaseIdentityAdapter: IdentityPort = {
  currentUserId: (): string | null => currentUser()?.uid ?? null,

  observeUserId: (listener: (userId: string | null) => void): (() => void) =>
    observeAuthState((user): void => {
      listener(user?.uid ?? null);
    }),

  getSession: (): Promise<AuthSession | null> => currentSession(),

  signInWithPassword: async (email: string, password: string): Promise<AuthSession> => {
    try {
      await signInWithEmail(email, password);
    } catch (error) {
      throw classify(error);
    }
    const session = await currentSession();
    if (!session) throw new IdentityError('unexpected', 'No se pudo leer la sesión tras el inicio.');
    return session;
  },

  signOut: async (): Promise<void> => {
    await signOutCurrentUser();
  },

  requestPasswordReset: async (email: string): Promise<void> => {
    try {
      await sendPasswordReset(email);
    } catch (error) {
      throw classify(error);
    }
  },
};

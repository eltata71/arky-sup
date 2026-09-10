/**
 * authService — the Firebase Auth boundary.
 *
 * Every other SDK in this app is wrapped by a service: Firestore by
 * `firestoreService`, the model providers by `services/ai`. Auth was the
 * exception — `context/AuthContext.tsx` imported fifteen symbols from
 * `firebase/auth` directly and made the calls itself. That is a React context
 * holding an SDK, which means the sign-in rules can only be exercised through
 * a component tree, and it is the one violation of the rule left anywhere in
 * `components/`, `pages/`, `context/` or `hooks/`.
 *
 * The split is the ordinary one: this module talks to Firebase, the context
 * translates what it returns into application state. Nothing here decides
 * *policy* — who may do what is `lib/authz`, and it is enforced for real by
 * `firestore.rules`.
 *
 * `isAuthAvailable()` exists because `auth` is null whenever the `VITE_FIREBASE_*`
 * variables are unset, which is a supported degraded mode rather than a fault.
 * Centralising that check is why the calls below can be written without an
 * `if (auth)` at every site — the omission that made one of them a latent
 * crash.
 */

import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getIdTokenResult,
  onAuthStateChanged,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth, isFirebaseAvailable } from '../../firebase';

/**
 * The authenticated identity.
 *
 * Re-exported so callers can name the type without importing the SDK, which
 * would defeat the point of the boundary while looking harmless.
 */
export type AuthUser = User;

/** Raised when a call is made while Firebase Auth is not configured. */
export class AuthUnavailableError extends Error {
  readonly code = 'auth/unavailable' as const;
  constructor(operation: string) {
    super(`La autenticación no está disponible (${operation}): falta la configuración de Firebase.`);
    this.name = 'AuthUnavailableError';
  }
}

export function isAuthAvailable(): boolean {
  return Boolean(isFirebaseAvailable && auth);
}

/** The SDK handle, or a typed failure. Never returns null to a caller. */
function requireAuth(operation: string) {
  if (!auth || !isFirebaseAvailable) throw new AuthUnavailableError(operation);
  return auth;
}

/** The signed-in identity right now, without waiting for a state change. */
export function currentUser(): AuthUser | null {
  return auth?.currentUser ?? null;
}

/**
 * Subscribe to sign-in state.
 *
 * Returns a no-op unsubscribe when auth is unavailable, so a caller's cleanup
 * path stays uniform instead of branching on configuration.
 */
export function observeAuthState(listener: (user: AuthUser | null) => void): () => void {
  if (!auth || !isFirebaseAvailable) {
    listener(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, listener);
}

/**
 * The `role` custom claim, forcing a token refresh.
 *
 * Refreshing matters: an administrator who has just been granted a role should
 * not have to sign out and back in, and a revoked one should not keep it for
 * up to an hour.
 */
export async function readRoleClaim(user: AuthUser): Promise<unknown> {
  const token = await getIdTokenResult(user, true);
  return token?.claims?.role;
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(requireAuth('signInWithEmail'), email, password);
}

export async function signInWithGooglePopup(): Promise<void> {
  await signInWithPopup(requireAuth('signInWithGoogle'), new GoogleAuthProvider());
}

/**
 * Anonymous sign-in, used only by the developer bypass.
 *
 * `isDeveloperLoginAllowed` hard-disables that bypass in production builds;
 * this function is the transport, not the gate, and must not be called from
 * anywhere else.
 */
export async function signInAnonymouslyForDevBypass(): Promise<AuthUser> {
  const credential = await signInAnonymously(requireAuth('signInAsDeveloper'));
  return credential.user;
}

/** Sign out. Safe to call when auth is unavailable: there is nothing to end. */
export async function signOutCurrentUser(): Promise<void> {
  if (!auth || !isFirebaseAvailable) return;
  await signOut(auth);
}

/**
 * Send a password-reset email.
 *
 * The caller resolves this the same way whether or not the address has an
 * account — that policy lives in the context, because it is about what the
 * product reveals, not about how Firebase behaves.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(requireAuth('sendPasswordReset'), email);
}

/**
 * Re-authenticate and change the password.
 *
 * Both steps together, because they are not separable: `updatePassword` on a
 * long-open session is exactly the case re-authentication exists to prevent,
 * and exposing them apart invites a call site that does only the second.
 */
export async function reauthenticateAndUpdatePassword(
  user: AuthUser,
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const credential = EmailAuthProvider.credential(email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

/** Update the signed-in user's display name. Never their role. */
export async function updateDisplayName(user: AuthUser, displayName: string): Promise<void> {
  await updateProfile(user, { displayName });
}

/**
 * Re-exported for `userProvisioningService`, which creates accounts on a named
 * secondary app so `createUserWithEmailAndPassword` cannot replace the
 * administrator's own session. It passes its own `Auth` instance, so this is a
 * pass-through rather than a call against the primary one.
 */
export { createUserWithEmailAndPassword };

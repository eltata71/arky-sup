import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
// No `firebase/auth` import: this context translates auth state into
// application state, and `services/identity/authService` is the only place that talks
// to the SDK. That is the same split every other SDK in the app already had.
import {
  currentUser as readCurrentUser,
  isAuthAvailable,
  readRoleClaim,
  reauthenticateAndUpdatePassword,
  sendPasswordReset as sendPasswordResetEmail,
  signInAnonymouslyForDevBypass,
  signInWithEmail,
  signInWithGooglePopup,
  signOutCurrentUser,
  updateDisplayName,
  type AuthUser as User,
  userService,
  type UserProfile as PersistedUserProfile,
} from '../services/identity';
import { isDeveloperLoginAllowed } from '../lib/security';
import { DEFAULT_PROVISIONED_ROLE, resolveEffectiveRole, type AuthRole } from '../lib/authz';
import { observabilityService } from '../services/observability';
import {
  loadSupabaseAuthClient,
  loadSupabaseDataClient,
  loadSupabaseIdentityPort,
} from '../services/adapters';
import {
  completeSupabasePasswordSetup as persistSupabasePassword,
  readSupabaseProfile,
  type SupabaseProfileClient,
  isSupabasePilotEmail,
  parseSupabasePilotEmails,
} from '../services/identity';
import { supabaseSessionUser, useAuthSessionBootstrap } from './auth/useAuthSessionBootstrap';

type UserProfile = PersistedUserProfile;

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  error: string | null;
  isDeveloperBypassAvailable: boolean;
  signInAsDeveloper: () => Promise<void>;
  /**
   * Google sign-in. Google is a way to *enter*, never a way to *exist*: an
   * identity with no provisioned profile is signed straight back out.
   */
  signInWithGoogle: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;

  // ---- the account a person governs themselves ----------------------------

  /**
   * Send a password-reset email.
   *
   * Resolves the same way whether or not the address belongs to an account:
   * a different answer would turn this into a way to ask the product which of
   * your colleagues has one.
   */
  sendPasswordReset: (email: string) => Promise<void>;
  /** Set the password from an authenticated Supabase invitation/recovery callback. */
  completeSupabasePasswordSetup: (newPassword: string) => Promise<void>;
  /** Change the signed-in user's password, re-authenticating first. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Edit the signed-in user's own display name. Never their role. */
  updateOwnDisplayName: (displayName: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const IDENTITY_ENV = import.meta.env as Record<string, string | undefined>;
const SUPABASE_PILOT_EMAILS = parseSupabasePilotEmails(IDENTITY_ENV.VITE_SUPABASE_PILOT_EMAILS);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isDeveloperLogin = React.useRef(false);
  const identityBackend = React.useRef<'firebase' | 'supabase'>('firebase');

  /**
   * Load the profile that governs this session.
   *
   * The previous version *created* one for any authenticated identity that
   * lacked it, which is how three different sign-in paths could each mint an
   * account. An account is now granted, never taken: an identity with no
   * provisioned profile is signed straight back out with an explanation.
   *
   * The role comes from `resolveEffectiveRole`, which is the one statement of
   * that rule in the codebase and is mirrored by `callerRole()` in
   * `firestore.rules`. Reimplementing the precedence here — even correctly —
   * would recreate exactly the split that made the UI and the server disagree.
   */
  const fetchUserProfile = async (uid: string, currentUser?: User) => {
    if (isDeveloperLogin.current) return;
    try {
      const existing = identityBackend.current === 'supabase'
        ? await readSupabaseProfile(
          (await loadSupabaseDataClient(IDENTITY_ENV)) as unknown as SupabaseProfileClient,
          uid,
          currentUser?.email ?? null,
        )
        : await userService.getUserProfile(uid);
      const claimRole = identityBackend.current === 'supabase' || !currentUser
        ? undefined
        : await readRoleClaim(currentUser);

      if (!existing) {
        // Not provisioned. Signing out here is the whole principle: an identity
        // that authenticated is not the same thing as an account that exists.
        observabilityService.recordWarning({
          source: 'app',
          title: 'Acceso denegado a una identidad sin cuenta',
          message: 'Alguien autenticó correctamente pero no tiene una cuenta creada por un administrador. La sesión se cerró.',
          metadata: { uid, email: currentUser?.email ?? 'unknown' },
          recoverable: true,
          userVisible: false,
        });
        setProfile(null);
        setUser(null);
        setError(
          'Tu identidad es válida pero no tiene una cuenta en Arky. Un administrador debe crearla antes de que puedas entrar.',
        );
        if (identityBackend.current === 'supabase') {
          await (await loadSupabaseIdentityPort(IDENTITY_ENV)).signOut();
        } else {
          await signOutCurrentUser();
        }
        return;
      }

      const resolved = identityBackend.current === 'supabase'
        ? existing.role
        : resolveEffectiveRole(claimRole, existing.role);

      if (!resolved) {
        observabilityService.recordWarning({
          source: 'app',
          title: 'Perfil con rol ilegible',
          message: `La sesión ${uid} no resuelve a ningún rol conocido. Opera sin permisos hasta que un administrador la corrija; las reglas de Firestore la rechazan igual.`,
          metadata: { uid, storedRole: String(existing.role), claimRole: String(claimRole ?? '') },
          recoverable: true,
          userVisible: false,
        });
      }

      // No default when it does not resolve. A profile whose role cannot be
      // read is not a viewer by accident — and `can()` fails closed on it,
      // which is the same answer the rules give.
      setProfile({ ...existing, role: (resolved ?? '') as AuthRole });
    } catch (err) {
      // Never fall back to a usable role on failure: a profile that could not
      // be read is not evidence of permission.
      observabilityService.reportError(err, {
        source: 'app',
        title: 'No se pudo cargar el perfil de usuario',
        message: 'La sesión queda sin permisos hasta que el perfil pueda leerse. Verifica conectividad y permisos del backend activo.',
        metadata: { uid },
        recoverable: true,
        userVisible: true,
      });
      setProfile(null);
    }
  };

  useAuthSessionBootstrap({
    env: IDENTITY_ENV,
    pilotEmails: SUPABASE_PILOT_EMAILS,
    identityBackend,
    fetchProfile: fetchUserProfile,
    setUser,
    setProfile,
    setError,
    setIsLoading,
  });

  const handleSignInAsDeveloper = useCallback(async () => {
    if (!isDeveloperLoginAllowed()) {
      const message =
        'El acceso de desarrollo está deshabilitado en este entorno. ' +
        'Define VITE_ENABLE_DEV_LOGIN=true en un build de desarrollo (vite dev) para habilitarlo.';
      setError(message);
      observabilityService.recordWarning({
        source: 'app',
        title: 'Intento de developer bypass bloqueado',
        message,
        recoverable: true,
        userVisible: true,
      });
      throw new Error(message);
    }

    try {
      setIsLoading(true);
      setError(null);
      isDeveloperLogin.current = true;

      const devUser = await signInAnonymouslyForDevBypass();

      // Developer bypass: build an EPHEMERAL superadmin profile in memory only.
      // We deliberately do NOT persist `superadmin` to Firestore — doing so
      // would let any anonymous bystander reach a privileged role on prod data
      // simply by hitting the endpoint with a leaked dev flag.
      const devProfile: UserProfile = {
        uid: devUser.uid,
        email: 'dev@arky.local',
        displayName: 'Developer (ephemeral superadmin)',
        role: 'superadmin',
      };

      // Best-effort: store a NON-PRIVILEGED profile so other services that
      // expect the user document to exist still work. The superadmin role stays
      // in React state only — persisting it would make a leaked dev flag a real
      // privilege on real data.
      try {
        await userService.createUserProfile({
          uid: devUser.uid,
          email: 'dev@arky.local',
          displayName: 'Developer (local)',
          role: DEFAULT_PROVISIONED_ROLE,
        });
      } catch (writeErr) {
        // Non-fatal in dev; surface as a warning.
        observabilityService.recordWarning({
          source: 'app',
          title: 'No se pudo crear el perfil de desarrollador en Firestore',
          message: 'El bypass continuará en memoria, pero algunos flujos que leen `users/{uid}` pueden fallar.',
          recoverable: true,
          userVisible: false,
          metadata: { error: writeErr instanceof Error ? writeErr.message : 'unknown' },
        });
      }

      setUser(devUser);
      setProfile(devProfile);

      observabilityService.recordWarning({
        source: 'app',
        title: 'Developer bypass activo',
        message: 'Sesión con rol superadmin EFÍMERO en memoria. No usar contra datos de producción.',
        recoverable: true,
        userVisible: false,
      });
    } catch (err: unknown) {
      const authError = err as { message?: string };
      observabilityService.reportError(err, {
        source: 'app',
        title: 'Developer bypass falló',
        message: authError.message ?? 'Verifica que Anonymous Auth esté habilitado en Firebase Console.',
        recoverable: true,
        userVisible: true,
      });
      setError(authError.message ?? 'Developer access failed.');
      isDeveloperLogin.current = false;
      throw err;
    } finally {
      setIsLoading(false);
      // Reset the flag a beat later so the auth-state listener does not race.
      window.setTimeout(() => {
        isDeveloperLogin.current = false;
      }, 1000);
    }
  }, []);

  const handleSignInWithGoogle = useCallback(async () => {
    if (identityBackend.current === 'supabase') {
      throw new Error('El piloto Supabase usa correo y contraseña; Google permanece en Firebase.');
    }
    try {
      setIsLoading(true);
      setError(null);
      await signInWithGooglePopup();
    } catch (err: unknown) {
      const authError = err as { code?: string; message?: string };
      if (authError.code === 'auth/unauthorized-domain') {
        setError(`Domain Unauthorized: Please add "${window.location.hostname}" to your Authorized Domains in Firebase Console (Authentication > Settings).`);
      } else {
        setError(authError.message ?? 'Google authentication failed');
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const useSupabase = isSupabasePilotEmail(email, SUPABASE_PILOT_EMAILS);
      identityBackend.current = useSupabase ? 'supabase' : 'firebase';
      if (useSupabase) {
        await (await loadSupabaseIdentityPort(IDENTITY_ENV)).signInWithPassword(email, password);
        const { data, error: sessionError } = await (await loadSupabaseAuthClient(IDENTITY_ENV)).auth.getSession();
        if (sessionError) throw sessionError;
        const selectedUser = supabaseSessionUser(data?.session ?? null);
        if (!selectedUser || !isSupabasePilotEmail(selectedUser.email, SUPABASE_PILOT_EMAILS)) {
          throw new Error('La sesión Supabase no pertenece a una identidad piloto autorizada.');
        }
        setUser(selectedUser);
        await fetchUserProfile(selectedUser.uid, selectedUser);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err: unknown) {
      const authError = err as { message?: string };
      setError(authError.message ?? 'Login failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      if (identityBackend.current === 'supabase') {
        await (await loadSupabaseIdentityPort(IDENTITY_ENV)).signOut();
        setUser(null);
      } else {
        await signOutCurrentUser();
      }
      setProfile(null);
    } catch (err: unknown) {
      const authError = err as { message?: string };
      setError(authError.message ?? 'Logout failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Memoised so the identity only changes when the auth state does.
   *
   * An inline object literal is a new value on every render, which makes every
   * consumer re-render whenever this provider does — and this one sits near the
   * root, above every route. The handlers above were made stable first: without
   * that, this `useMemo` would recompute on every render anyway and buy nothing.
   */

  /**
   * Send a password-reset email.
   *
   * Deliberately resolves the same way whether or not the address belongs to an
   * account. Reporting "no such user" would turn the reset form into a way to
   * ask the product which of your colleagues has an account.
   */
  const sendPasswordReset = useCallback(async (email: string) => {
    const address = email.trim();
    if (!address) throw new Error('Escribe tu correo para enviarte el enlace.');
    try {
      setError(null);
      if (isSupabasePilotEmail(address, SUPABASE_PILOT_EMAILS)) {
        await (await loadSupabaseIdentityPort(IDENTITY_ENV)).requestPasswordReset(address);
      } else if (isAuthAvailable()) {
        await sendPasswordResetEmail(address);
      }
    } catch (err) {
      // Logged, never surfaced: the caller shows the same confirmation either
      // way, so a failure here must not become an existence oracle.
      observabilityService.recordWarning({
        source: 'app',
        title: 'Envío de recuperación de contraseña no completado',
        message: 'Firebase rechazó el envío. El usuario ve la confirmación genérica de todos modos.',
        metadata: { reason: err instanceof Error ? err.message : 'unknown' },
        recoverable: true,
        userVisible: false,
      });
    }
  }, []);

  const completeSupabasePasswordSetup = useCallback(async (newPassword: string) => {
    if (newPassword.length < 12) {
      throw new Error('La contraseña debe tener al menos 12 caracteres.');
    }
    const client = await loadSupabaseAuthClient(IDENTITY_ENV);
    const { data, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    const callbackUser = supabaseSessionUser(data?.session ?? null);
    if (!callbackUser || !isSupabasePilotEmail(callbackUser.email, SUPABASE_PILOT_EMAILS)) {
      throw new Error('El enlace para definir la contraseña expiró o no pertenece a la cohorte piloto. Solicita uno nuevo.');
    }
    identityBackend.current = 'supabase';
    await persistSupabasePassword(client, newPassword);
    setUser(callbackUser);
    await fetchUserProfile(callbackUser.uid, callbackUser);
  }, []);

  /**
   * Change the signed-in user's password.
   *
   * Re-authentication first: `updatePassword` on a session that has been open
   * for a while is precisely the operation someone performs on an unattended
   * laptop, and Firebase requires a recent login for it anyway.
   */
  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const current = readCurrentUser();
    if (!current?.email) {
      throw new Error('Solo una sesión con correo y contraseña puede cambiar la contraseña aquí.');
    }
    if (newPassword.length < 8) {
      throw new Error('La contraseña nueva debe tener al menos 8 caracteres.');
    }
    try {
      setError(null);
      await reauthenticateAndUpdatePassword(current, current.email, currentPassword, newPassword);
    } catch (err) {
      const message = err instanceof Error && /wrong-password|invalid-credential/.test(err.message)
        ? 'La contraseña actual no es correcta.'
        : 'No se pudo cambiar la contraseña. Vuelve a iniciar sesión e inténtalo de nuevo.';
      setError(message);
      throw new Error(message);
    }
  }, []);

  /**
   * Edit the signed-in user's own display name — and nothing else.
   *
   * The role is not editable here by omission and by rule: `firestore.rules`
   * refuses a write that changes `role` on your own document, so this staying
   * narrow is a convenience, not the control.
   */
  const updateOwnDisplayName = useCallback(async (displayName: string) => {
    const current = readCurrentUser();
    const name = displayName.trim();
    if (!current) throw new Error('No hay una sesión activa.');
    if (name.length < 2) throw new Error('El nombre debe tener al menos 2 caracteres.');
    await updateDisplayName(current, name);
    await userService.updateOwnDisplayName(current.uid, name);
    setProfile((previous) => (previous ? { ...previous, displayName: name } : previous));
  }, []);

  const value = useMemo<AuthContextType>(() => ({
    user,
    profile,
    isLoading,
    error,
    isDeveloperBypassAvailable: isDeveloperLoginAllowed(),
    signInAsDeveloper: handleSignInAsDeveloper,
    signInWithGoogle: handleSignInWithGoogle,
    login,
    logout,
    sendPasswordReset,
    completeSupabasePasswordSetup,
    changePassword,
    updateOwnDisplayName,
  }), [
    user,
    profile,
    isLoading,
    error,
    handleSignInAsDeveloper,
    handleSignInWithGoogle,
    login,
    logout,
    sendPasswordReset,
    completeSupabasePasswordSetup,
    changePassword,
    updateOwnDisplayName,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

/**
 * Like {@link useAuth} but returns `undefined` outside a provider instead of
 * throwing — the same escape hatch `useOptionalAppContext` already provides.
 *
 * It exists for hooks that hang off a *field* rather than off a screen: the
 * capture assistant sits next to every input in six forms, and those dialogs
 * are also mounted on their own in component tests. Without a session there is
 * no stored agent card to load and no model to call, which the caller handles
 * as "not available here" — a far better outcome than a dialog that refuses to
 * render because a peripheral button wanted to know who was signed in.
 */
export const useOptionalAuth = () => useContext(AuthContext);

// Authorization is asked for by permission, not by role name. Consumers import
// `can` from `lib/authz`; this module deliberately re-exports no role predicate.
export type { AuthRole };

import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';
// No SDK import: this context translates auth state into application state, and
// `services/identity` is the only place that talks to Supabase Auth. That is
// the same split every other SDK in the app already had.
import {
  currentUser as readCurrentUser,
  isAuthAvailable,
  reauthenticateAndUpdatePassword,
  rememberAuthUser,
  sendPasswordReset as sendPasswordResetEmail,
  signInWithEmail,
  signOutCurrentUser,
  userService,
  completeSupabasePasswordSetup as persistSupabasePassword,
  toAuthUser,
  type AuthUser as User,
  type UserProfile as PersistedUserProfile,
} from '../services/identity';
import { isDeveloperLoginAllowed } from '../lib/security';
import { type AuthRole } from '../lib/authz';
import { observabilityService } from '../services/observability';
import { loadSupabaseAuthClient } from '../services/adapters';
import { useAuthSessionBootstrap } from './auth/useAuthSessionBootstrap';

type UserProfile = PersistedUserProfile;

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  isLoading: boolean;
  error: string | null;
  isDeveloperBypassAvailable: boolean;
  signInAsDeveloper: () => Promise<void>;
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
  /** Set the password from an authenticated invitation/recovery callback. */
  completeSupabasePasswordSetup: (newPassword: string) => Promise<void>;
  /** Change the signed-in user's password, re-authenticating first. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  /** Edit the signed-in user's own display name. Never their role. */
  updateOwnDisplayName: (displayName: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const IDENTITY_ENV = import.meta.env as Record<string, string | undefined>;

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isDeveloperLogin = React.useRef(false);

  /**
   * Load the profile that governs this session.
   *
   * An earlier version *created* one for any authenticated identity that lacked
   * it, which is how three different sign-in paths could each mint an account.
   * An account is granted, never taken: an identity with no provisioned profile
   * is signed straight back out with an explanation.
   *
   * The role is whatever `api.load_own_profile` returns, and that RPC fails
   * closed — no profile, or a disabled one, comes back as nothing. There is no
   * second opinion to reconcile any more: the custom claim that
   * `resolveEffectiveRole` had to weigh against the stored role was Firebase's,
   * and PostgreSQL reads the same row the policies read.
   */
  const fetchUserProfile = async (uid: string, currentUser?: User) => {
    if (isDeveloperLogin.current) return;
    try {
      const existing = await userService.getOwnProfile();

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
        await signOutCurrentUser();
        return;
      }

      setProfile({ ...existing, email: existing.email ?? currentUser?.email ?? null });
    } catch (err) {
      // Never fall back to a usable role on failure: a profile that could not
      // be read is not evidence of permission.
      observabilityService.reportError(err, {
        source: 'app',
        title: 'No se pudo cargar el perfil de usuario',
        message: 'La sesión queda sin permisos hasta que el perfil pueda leerse. Verifica conectividad y permisos del backend.',
        metadata: { uid },
        recoverable: true,
        userVisible: true,
      });
      setProfile(null);
    }
  };

  useAuthSessionBootstrap({
    fetchProfile: fetchUserProfile,
    setUser,
    setProfile,
    setError,
    setIsLoading,
  });

  /**
   * Developer bypass — entirely in memory.
   *
   * It used to open a real anonymous session against the provider and then
   * write a non-privileged profile row, because the app needed `users/{uid}` to
   * exist. Both halves are gone: the `superadmin` role always lived in React
   * state only, and creating a real identity to prop it up was the worst of
   * both worlds — a real account with a fake role. `isDeveloperLoginAllowed`
   * hard-disables this in production builds.
   */
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

    setIsLoading(true);
    setError(null);
    isDeveloperLogin.current = true;

    const devUser: User = {
      uid: 'dev-local',
      email: 'dev@arky.local',
      displayName: 'Developer (ephemeral superadmin)',
    };
    rememberAuthUser(devUser);
    setUser(devUser);
    setProfile({
      uid: devUser.uid,
      email: devUser.email,
      displayName: devUser.displayName,
      role: 'superadmin',
      status: 'active',
    });
    setIsLoading(false);

    observabilityService.recordWarning({
      source: 'app',
      title: 'Developer bypass activo',
      message: 'Sesión con rol superadmin EFÍMERO en memoria. No escribe nada en el backend y no sirve contra datos reales.',
      recoverable: true,
      userVisible: false,
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const signedIn = await signInWithEmail(email, password);
      setUser(signedIn);
      await fetchUserProfile(signedIn.uid, signedIn);
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
      isDeveloperLogin.current = false;
      await signOutCurrentUser();
      setUser(null);
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
      if (isAuthAvailable()) await sendPasswordResetEmail(address);
    } catch (err) {
      // Logged, never surfaced: the caller shows the same confirmation either
      // way, so a failure here must not become an existence oracle.
      observabilityService.recordWarning({
        source: 'app',
        title: 'Envío de recuperación de contraseña no completado',
        message: 'El proveedor rechazó el envío. El usuario ve la confirmación genérica de todos modos.',
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
    const callbackSession = await persistSupabasePassword(
      await loadSupabaseAuthClient(IDENTITY_ENV),
      window.location.hash,
      newPassword,
    );
    const callbackUser = toAuthUser(callbackSession);
    if (!callbackUser) {
      throw new Error('El enlace para definir la contraseña expiró. Solicita uno nuevo.');
    }
    rememberAuthUser(callbackUser);
    setUser(callbackUser);
    await fetchUserProfile(callbackUser.uid, callbackUser);
  }, []);

  /**
   * Change the signed-in user's password.
   *
   * Re-authentication first: `updateUser({ password })` on a session that has
   * been open for a while is precisely the operation someone performs on an
   * unattended laptop.
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
      const message = err instanceof Error && /invalid login credentials|invalid_credentials|wrong-password/i.test(err.message)
        ? 'La contraseña actual no es correcta.'
        : 'No se pudo cambiar la contraseña. Vuelve a iniciar sesión e inténtalo de nuevo.';
      setError(message);
      throw new Error(message, { cause: err });
    }
  }, []);

  /**
   * Edit the signed-in user's own display name — and nothing else.
   *
   * `api.update_own_display_name` writes one column on one row, the caller's,
   * so this staying narrow is a convenience and the RPC is the control.
   */
  const updateOwnDisplayName = useCallback(async (displayName: string) => {
    const current = readCurrentUser();
    const name = displayName.trim();
    if (!current) throw new Error('No hay una sesión activa.');
    if (name.length < 2) throw new Error('El nombre debe tener al menos 2 caracteres.');
    await userService.updateOwnDisplayName(current.uid, name);
    setProfile((previous) => (previous ? { ...previous, displayName: name } : previous));
  }, []);

  /**
   * Memoised so the identity only changes when the auth state does.
   *
   * An inline object literal is a new value on every render, which makes every
   * consumer re-render whenever this provider does — and this one sits near the
   * root, above every route. The handlers above were made stable first: without
   * that, this `useMemo` would recompute on every render anyway and buy nothing.
   */
  const value = useMemo<AuthContextType>(() => ({
    user,
    profile,
    isLoading,
    error,
    isDeveloperBypassAvailable: isDeveloperLoginAllowed(),
    signInAsDeveloper: handleSignInAsDeveloper,
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

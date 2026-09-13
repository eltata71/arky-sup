import { useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  isAuthAvailable,
  observeAuthState as observeFirebase,
  signOutCurrentUser,
  type AuthUser,
  type UserProfile,
  isSupabasePilotEmail,
} from '../../services/identity';
import {
  loadSupabaseAuthClient,
  loadSupabaseIdentityPort,
  type SupabaseSessionLike,
} from '../../services/adapters';

type IdentityBackendRef = { current: 'firebase' | 'supabase' };

interface AuthBootstrapOptions {
  readonly env: Record<string, string | undefined>;
  readonly pilotEmails: readonly string[];
  readonly identityBackend: IdentityBackendRef;
  readonly fetchProfile: (uid: string, currentUser?: AuthUser) => Promise<void>;
  readonly setUser: Dispatch<SetStateAction<AuthUser | null>>;
  readonly setProfile: Dispatch<SetStateAction<UserProfile | null>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setIsLoading: Dispatch<SetStateAction<boolean>>;
}

export const supabaseSessionUser = (session: SupabaseSessionLike | null | undefined): AuthUser | null => {
  const raw = session?.user;
  if (typeof raw?.id !== 'string' || raw.id === '') return null;
  const metadata = raw.user_metadata;
  const displayName = typeof metadata?.full_name === 'string'
    ? metadata.full_name
    : typeof metadata?.name === 'string' ? metadata.name : null;
  // The UI intentionally depends only on uid, email, displayName and
  // providerData. Firebase's wider SDK type stays at the provider boundary.
  return {
    uid: raw.id,
    email: typeof raw.email === 'string' ? raw.email : null,
    displayName,
    providerData: [],
  } as unknown as AuthUser;
};

/** Restores an established pilot Supabase session; otherwise retains Firebase. */
export function useAuthSessionBootstrap({
  env,
  pilotEmails,
  identityBackend,
  fetchProfile,
  setUser,
  setProfile,
  setError,
  setIsLoading,
}: AuthBootstrapOptions): void {
  useEffect(() => {
    let cancelled = false;
    let unsubscribeSupabase = (): void => undefined;
    let unsubscribeFirebase = (): void => undefined;

    const clearSession = (): void => {
      if (cancelled) return;
      setUser(null);
      setProfile(null);
      setIsLoading(false);
    };
    const startFirebase = (): void => {
      identityBackend.current = 'firebase';
      if (!isAuthAvailable()) {
        setError('La configuración de Firebase está incompleta. La autenticación y persistencia remota están deshabilitadas.');
        clearSession();
        return;
      }
      unsubscribeFirebase = observeFirebase(async (currentUser) => {
        if (!currentUser) {
          clearSession();
          return;
        }
        if (isSupabasePilotEmail(currentUser.email, pilotEmails)) {
          await signOutCurrentUser();
          if (!cancelled) {
            setError('Esta cuenta forma parte del piloto Supabase. Inicia sesión con tu contraseña del piloto.');
            clearSession();
          }
          return;
        }
        if (cancelled) return;
        setUser(currentUser);
        await fetchProfile(currentUser.uid, currentUser);
        if (!cancelled) setIsLoading(false);
      });
    };
    const start = async (): Promise<void> => {
      if (pilotEmails.length > 0) {
        try {
          const client = await loadSupabaseAuthClient(env);
          const { data, error: sessionError } = await client.auth.getSession();
          if (sessionError) throw sessionError;
          const selectedUser = supabaseSessionUser(data?.session ?? null);
          if (selectedUser && isSupabasePilotEmail(selectedUser.email, pilotEmails)) {
            identityBackend.current = 'supabase';
            const port = await loadSupabaseIdentityPort(env);
            const synchronize = async (): Promise<void> => {
              const snapshot = await client.auth.getSession();
              if (snapshot.error) throw snapshot.error;
              const nextUser = supabaseSessionUser(snapshot.data?.session ?? null);
              if (!nextUser) {
                clearSession();
                return;
              }
              if (cancelled) return;
              setUser(nextUser);
              await fetchProfile(nextUser.uid, nextUser);
              if (!cancelled) setIsLoading(false);
            };
            unsubscribeSupabase = port.observeUserId(() => { void synchronize(); });
            await synchronize();
            return;
          }
        } catch {
          // Firebase remains the safe default unless a known pilot session was
          // established. The login path reports Supabase configuration failures.
        }
      }
      startFirebase();
    };
    void start();
    return () => {
      cancelled = true;
      unsubscribeSupabase();
      unsubscribeFirebase();
    };
    // Bootstrap only on provider mount. Its dependencies are stable React
    // setters or refs; rerunning on every parent render would resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

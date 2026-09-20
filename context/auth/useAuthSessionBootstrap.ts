import { useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  isAuthAvailable,
  observeAuthState,
  type AuthUser,
  type UserProfile,
} from '../../services/identity';

interface AuthBootstrapOptions {
  readonly fetchProfile: (uid: string, currentUser?: AuthUser) => Promise<void>;
  readonly setUser: Dispatch<SetStateAction<AuthUser | null>>;
  readonly setProfile: Dispatch<SetStateAction<UserProfile | null>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setIsLoading: Dispatch<SetStateAction<boolean>>;
}

/**
 * Restaura la sesión establecida y la mantiene sincronizada.
 *
 * Con un solo proveedor esto vuelve a ser lo que siempre debió ser: una
 * suscripción. La versión anterior tenía que decidir entre dos backends leyendo
 * una lista de correos del piloto, y esa decisión —tomada en el arranque, antes
 * de saber quién era la persona— era la fuente de la mitad de los casos
 * extraños de esta pantalla.
 */
export function useAuthSessionBootstrap({
  fetchProfile,
  setUser,
  setProfile,
  setError,
  setIsLoading,
}: AuthBootstrapOptions): void {
  useEffect(() => {
    let cancelled = false;

    if (!isAuthAvailable()) {
      setError('La configuración de Supabase está incompleta. La autenticación y la persistencia remota están deshabilitadas.');
      setUser(null);
      setProfile(null);
      setIsLoading(false);
      return () => undefined;
    }

    const unsubscribe = observeAuthState((currentUser) => {
      if (cancelled) return;
      if (!currentUser) {
        setUser(null);
        setProfile(null);
        setIsLoading(false);
        return;
      }
      setUser(currentUser);
      void fetchProfile(currentUser.uid, currentUser).finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // Bootstrap only on provider mount. Its dependencies are stable React
    // setters or refs; rerunning on every parent render would resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

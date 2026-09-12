/**
 * Adaptador Firebase del `IdentityPort` (F3.2).
 *
 * El dominio habla con `IdentityPort`; este fichero es el único sitio —junto
 * con `services/identity`— donde ese puerto se rellena con Firebase. Cuando
 * F4 implemente el adaptador Supabase Auth lo hará contra el mismo puerto y
 * la selección vivirá en `backendSelection`, no en los llamadores.
 *
 * No reexporta el SDK ni tipos de Firebase: el `uid` es `string` y la sesión
 * es presencia/ausencia, que es todo lo que el dominio necesita.
 */
import { currentUser, observeAuthState } from '../identity';
import type { IdentityPort } from '../ports';

export const firebaseIdentityAdapter: IdentityPort = {
  currentUserId: (): string | null => currentUser()?.uid ?? null,
  observeUserId: (listener: (userId: string | null) => void): (() => void) =>
    observeAuthState((user): void => {
      listener(user?.uid ?? null);
    }),
};

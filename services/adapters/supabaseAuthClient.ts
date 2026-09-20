/**
 * El puerto de identidad, servido por Supabase Auth (F4.1).
 *
 * Este fichero ya no construye nada: `supabaseClient.ts` es el único sitio
 * donde se llama a `createClient`, y aquí sólo se le pide esa instancia y se la
 * envuelve en el `IdentityPort`. Construir un cliente propio era el defecto que
 * mandaba a `/auth` a quien acababa de iniciar sesión — el porqué está escrito
 * en `supabaseClient.ts`, junto al código que lo impide.
 */
import { type IdentityPort } from '../ports';
import { loadSupabaseClient, resetSupabaseClientCache } from './supabaseClient';
import { createSupabaseIdentityAdapter, type SupabaseAuthClientLike } from './supabaseIdentityAdapter';

/** Reinicia el cliente memorizado. Solo para pruebas. */
export function resetSupabaseAuthClientCache(): void {
  resetSupabaseClientCache();
}

/**
 * El cliente de Auth: la instancia compartida, vista por su superficie de
 * identidad.
 *
 * Falla con `BackendUnavailableError` si falta configuración, en vez de
 * devolver un cliente que responderá errores oscuros más adelante.
 */
export async function loadSupabaseAuthClient(
  env: Record<string, string | undefined>,
): Promise<SupabaseAuthClientLike> {
  const client = await loadSupabaseClient(env, 'auth');
  return client as unknown as SupabaseAuthClientLike;
}

/** Puerto de identidad servido por Supabase Auth. */
export async function loadSupabaseIdentityPort(
  env: Record<string, string | undefined>,
): Promise<IdentityPort> {
  return createSupabaseIdentityAdapter(await loadSupabaseAuthClient(env));
}

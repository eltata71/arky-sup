/**
 * Carga del cliente de Supabase Auth (F4.1).
 *
 * Es el ÚNICO fichero que importa `@supabase/supabase-js`, y lo hace de forma
 * dinámica: el SDK queda en un chunk perezoso en vez de viajar en el arranque.
 * La regla del repositorio es explícita al respecto —un barril desde código
 * perezoso, un archivo desde código del arranque— y el presupuesto eager lo
 * confirma: el cliente de Supabase no entra en la carga inicial de la SPA.
 *
 * La URL y la clave son las publicables (`sb_publishable_…`). La clave de
 * servicio no se usa aquí y no debe aparecer en `VITE_*`: llegaría al navegador
 * dentro del bundle.
 */
import { BackendUnavailableError, type IdentityPort } from '../ports';
import { createSupabaseIdentityAdapter, type SupabaseAuthClientLike } from './supabaseIdentityAdapter';

let cached: SupabaseAuthClientLike | null = null;

/** Reinicia el cliente memorizado. Solo para pruebas. */
export function resetSupabaseAuthClientCache(): void {
  cached = null;
}

/**
 * Construye (una sola vez) el cliente de Auth.
 *
 * Falla con `BackendUnavailableError` si falta configuración, en vez de crear un
 * cliente que responderá errores oscuros más adelante.
 */
export async function loadSupabaseAuthClient(
  env: Record<string, string | undefined>,
): Promise<SupabaseAuthClientLike> {
  if (cached) return cached;

  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (url === '' || key === '') {
    throw new BackendUnavailableError('supabase', 'auth: configuración ausente');
  }

  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  cached = client as unknown as SupabaseAuthClientLike;
  return cached;
}

/** Puerto de identidad servido por Supabase Auth. */
export async function loadSupabaseIdentityPort(
  env: Record<string, string | undefined>,
): Promise<IdentityPort> {
  return createSupabaseIdentityAdapter(await loadSupabaseAuthClient(env));
}

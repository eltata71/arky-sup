/**
 * Puerta de datos Supabase. El cliente se crea perezosamente y solo con clave
 * publicable; `service_role` no pertenece ni puede aparecer en el navegador.
 */
import { BackendUnavailableError } from '../ports';

export interface SupabaseDataClientLike {
  from(table: string): unknown;
  rpc(name: string, args: Record<string, unknown>): Promise<unknown>;
}

let cached: SupabaseDataClientLike | null = null;

export function isSupabaseDataBackendConfigured(env: Record<string, string | undefined>): boolean {
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  return url !== '' && key !== '';
}

/** Carga el SDK fuera del arranque; los repositorios reciben solo su contrato. */
export async function loadSupabaseDataClient(
  env: Record<string, string | undefined>,
): Promise<SupabaseDataClientLike> {
  if (cached) return cached;
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (url === '' || key === '') {
    throw new BackendUnavailableError('supabase', 'datos: configuración ausente');
  }
  const { createClient } = await import('@supabase/supabase-js');
  cached = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) as unknown as SupabaseDataClientLike;
  return cached;
}

/** Siempre lanza hasta que un repositorio de contexto implemente su contrato. */
export function requireSupabaseDataBackend(operation: string): never {
  throw new BackendUnavailableError('supabase', operation);
}

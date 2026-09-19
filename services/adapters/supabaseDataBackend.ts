/**
 * La puerta de datos: `callRpc`, sobre el cliente compartido.
 *
 * Este fichero ya no construye nada. `supabaseClient.ts` es el único sitio
 * donde se llama a `createClient`, y ahí está escrito por qué tiene que ser
 * uno solo: dos instancias con `persistSession` sobre la misma clave de
 * almacenamiento se pelean por el refresh token, y el resultado que ve una
 * persona es iniciar sesión y volver a la pantalla de inicio de sesión.
 *
 * Todo el acceso a datos del producto entra por aquí o por el repositorio del
 * contexto, que a su vez entra por aquí. El esquema `api` lo fija el cliente
 * compartido, porque no hay ninguna lectura que deba salirse de él.
 */
import { loadSupabaseClient, isSupabaseConfigured, resetSupabaseClientCache } from './supabaseClient';

/**
 * Lo mínimo que los repositorios usan del cliente.
 *
 * Alias del contrato compartido: el dominio no depende de
 * `@supabase/supabase-js` ni siquiera en tipos.
 */
export type { SupabaseClientLike as SupabaseDataClientLike } from './supabaseClient';

export function isSupabaseDataBackendConfigured(env: Record<string, string | undefined>): boolean {
  return isSupabaseConfigured(env);
}

/** Reinicia el cliente memorizado. Solo para pruebas. */
export function resetSupabaseDataClientCache(): void {
  resetSupabaseClientCache();
}

/** El cliente compartido, visto por su superficie de datos. */
export async function loadSupabaseDataClient(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
) {
  return loadSupabaseClient(env, 'datos');
}

/**
 * Llama una RPC del esquema `api` y devuelve su carga, o lanza el error tal cual.
 *
 * Que lance —en vez de devolver `{ data, error }`— es deliberado: el sobre del
 * SDK hace que un `if (error)` olvidado se lea como una lectura vacía, y una
 * lectura vacía en este producto se pinta como un portafolio sin trabajo. Lo
 * que se lanza conserva el `code` de PostgreSQL, que es lo que
 * `classifySupabaseError` necesita para decidir si hay que reintentar, guardar
 * un borrador o pedirle a la persona que vuelva a entrar.
 */
export async function callRpc<T>(
  name: string,
  args: Record<string, unknown> = {},
  env?: Record<string, string | undefined>,
): Promise<T> {
  const client = await loadSupabaseDataClient(env);
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data as T;
}

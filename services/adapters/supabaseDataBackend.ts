/**
 * La puerta de datos de Supabase: un cliente, cargado una vez y en diferido.
 *
 * El SDK se importa **dinámicamente**, aquí y en `supabaseAuthClient.ts`, y por
 * ningún otro sitio. Es la regla del barril contra el bundle escrita en su caso
 * más caro: `@supabase/supabase-js` arrastra su propio `postgrest`, `realtime`,
 * `storage` y `gotrue`, y un `import` estático desde el árbol de proveedores lo
 * pondría entero en la carga inicial, antes de que se pinte la pantalla de
 * inicio de sesión.
 *
 * Sólo se usa la **clave publicable**. `service_role` no pertenece al navegador
 * y no puede aparecer en una variable `VITE_*`: viajaría dentro del bundle, que
 * es texto que cualquiera descarga. Las operaciones que necesitan esa clave
 * viven en `supabase/functions/`, no aquí.
 *
 * `auth: { persistSession: true }` importa más de lo que parece: es lo que hace
 * que este cliente y el de identidad compartan la misma sesión almacenada, de
 * modo que `auth.uid()` dentro de una RPC es la persona que de verdad está
 * usando la aplicación. Sin eso, cada RPC llegaría como anónima y **todo**
 * fallaría con «se requiere sesión».
 */
import { BackendUnavailableError } from '../ports';

/**
 * Lo mínimo que los repositorios usan del cliente.
 *
 * Se declara aquí en vez de exportar el tipo del SDK para que el dominio no
 * dependa de `@supabase/supabase-js` ni siquiera en tipos: un `import type` es
 * una dependencia de compilación, y lo que hace que un módulo entre en el grafo
 * de un chequeo `strict` es exactamente eso.
 */
export interface SupabaseDataClientLike {
  from(table: string): unknown;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

let cached: SupabaseDataClientLike | null = null;
let pending: Promise<SupabaseDataClientLike> | null = null;

const readConfig = (env: Record<string, string | undefined>): { url: string; key: string } => ({
  url: (env.VITE_SUPABASE_URL ?? '').trim(),
  key: (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim(),
});

export function isSupabaseDataBackendConfigured(env: Record<string, string | undefined>): boolean {
  const { url, key } = readConfig(env);
  return url !== '' && key !== '';
}

/** Reinicia el cliente memorizado. Solo para pruebas. */
export function resetSupabaseDataClientCache(): void {
  cached = null;
  pending = null;
}

/**
 * Carga el SDK fuera del arranque; los repositorios reciben solo su contrato.
 *
 * `pending` evita la carrera que el `if (cached)` solo no cubre: dos
 * repositorios que arrancan a la vez —y en el arranque siempre son dos— crearían
 * dos clientes, cada uno con su propio canal de renovación de token.
 */
export async function loadSupabaseDataClient(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): Promise<SupabaseDataClientLike> {
  if (cached) return cached;
  if (pending) return pending;
  const { url, key } = readConfig(env);
  if (url === '' || key === '') {
    throw new BackendUnavailableError('supabase', 'datos: configuración ausente');
  }
  pending = (async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
      db: { schema: 'api' },
    }) as unknown as SupabaseDataClientLike;
    cached = client;
    pending = null;
    return client;
  })();
  return pending;
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

/**
 * El cliente de Supabase. **Uno**, y ésta es la única puerta.
 *
 * Es el único fichero que importa `@supabase/supabase-js`, y lo hace de forma
 * dinámica: el SDK arrastra su propio `postgrest`, `realtime`, `storage` y
 * `gotrue`, así que un `import` estático lo pondría entero en la carga inicial,
 * antes de que se pinte la pantalla de inicio de sesión.
 *
 * ## Por qué hay uno y no dos
 *
 * Hasta F9.1 había **dos** `createClient`: uno para identidad y otro para
 * datos, cada uno con `persistSession: true` y —al no declarar `storageKey`—
 * **la misma clave de almacenamiento**. El comentario que acompañaba al segundo
 * afirmaba que compartir el almacenamiento hacía que compartieran la sesión.
 * Es exactamente al revés, y el SDK lo avisa por consola: *«Multiple
 * GoTrueClient instances detected in the same browser context … may produce
 * undefined behavior when used concurrently under the same storage key»*.
 *
 * El modo de fallo no era teórico y costó los tres recorridos autenticados de
 * la suite E2E. Los dos clientes traen `autoRefreshToken`, así que los dos
 * renuevan **el mismo** refresh token; el que llega segundo recibe
 * `refresh_token_already_used`, y ante eso el SDK hace lo único prudente que
 * puede hacer: borra la sesión almacenada y emite `SIGNED_OUT`. Ese evento
 * llega a `useAuthSessionBootstrap`, que lo traduce a `setUser(null)`, y
 * `ProtectedRoute` manda a `/auth`. Visto desde fuera: **iniciar sesión
 * correctamente y aparecer de vuelta en la pantalla de inicio de sesión**, sin
 * ningún error a la vista.
 *
 * Un cliente único no es una simplificación, es la corrección: una sesión, un
 * canal de renovación, y `auth.uid()` dentro de una RPC es de verdad la persona
 * que está usando la aplicación.
 *
 * ## Qué sirve
 *
 * Los tres usos del producto cuelgan de esta misma instancia —identidad
 * (`supabaseAuthClient`), datos (`supabaseDataBackend`) y archivos
 * (`supabaseFileStorage`)—, y por eso `db: { schema: 'api' }` se declara aquí:
 * todo el acceso a datos entra por RPC de ese esquema, y Auth y Storage no
 * leen esa opción.
 *
 * Sólo se usa la **clave publicable**. `service_role` no pertenece al navegador
 * y no puede aparecer en una variable `VITE_*`: viajaría dentro del bundle, que
 * es texto que cualquiera descarga. Lo que necesita esa clave vive en
 * `supabase/functions/`.
 */
import { BackendUnavailableError } from '../ports';

/**
 * Lo mínimo que este repositorio usa del cliente.
 *
 * Se declara aquí en vez de exportar el tipo del SDK para que el dominio no
 * dependa de `@supabase/supabase-js` ni siquiera en tipos: un `import type` es
 * una dependencia de compilación, y es exactamente eso lo que mete un módulo en
 * el grafo de un chequeo `strict`.
 */
export interface SupabaseClientLike {
  from(table: string): unknown;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

let cached: SupabaseClientLike | null = null;
let pending: Promise<SupabaseClientLike> | null = null;

const readConfig = (env: Record<string, string | undefined>): { url: string; key: string } => ({
  url: (env.VITE_SUPABASE_URL ?? '').trim(),
  key: (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim(),
});

/** ¿Hay configuración suficiente para hablar con el proyecto? */
export function isSupabaseConfigured(env: Record<string, string | undefined>): boolean {
  const { url, key } = readConfig(env);
  return url !== '' && key !== '';
}

/** Reinicia el cliente memorizado. Solo para pruebas. */
export function resetSupabaseClientCache(): void {
  cached = null;
  pending = null;
}

/**
 * Construye (una sola vez) el cliente, o devuelve el ya construido.
 *
 * `pending` cubre la carrera que el `if (cached)` por sí solo no cubre: en el
 * arranque siempre hay al menos dos llamantes a la vez —la restauración de
 * sesión y la primera lectura de datos—, y sin este guardo volverían a existir
 * dos instancias, que es justo el defecto que este módulo existe para cerrar.
 *
 * Falla con `BackendUnavailableError` si falta configuración, en vez de crear
 * un cliente que responderá errores oscuros más adelante. `purpose` viaja al
 * mensaje para que el registro diga qué se estaba intentando hacer.
 */
export async function loadSupabaseClient(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
  purpose = 'supabase',
): Promise<SupabaseClientLike> {
  if (cached) return cached;
  if (pending) return pending;

  const { url, key } = readConfig(env);
  if (url === '' || key === '') {
    throw new BackendUnavailableError('supabase', `${purpose}: configuración ausente`);
  }

  pending = (async () => {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const client = createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // El retorno de un proveedor OAuth —y el enlace de invitación o de
          // recuperación— traen la sesión en el fragmento de la URL. Dejarlo
          // en manos del SDK es lo que hace que el acceso con Google no
          // necesite una ruta de callback propia.
          detectSessionInUrl: true,
        },
        db: { schema: 'api' },
      }) as unknown as SupabaseClientLike;
      cached = client;
      return client;
    } finally {
      // En el camino de error también: dejar `pending` con una promesa
      // rechazada haría que el siguiente intento fallara sin volver a probar.
      pending = null;
    }
  })();

  return pending;
}

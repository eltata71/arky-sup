/**
 * Cómo se lee un fallo de PostgreSQL desde el navegador, dicho una sola vez.
 *
 * Esta tabla estaba escrita **cinco veces** —en los repositorios Supabase de
 * configuración, iniciativas, encargos, grafo y aprendizaje— con diferencias
 * que no eran decisiones: uno trataba `23505` como conflicto y otro no lo
 * mencionaba. Cinco copias de una clasificación de errores es cinco formas de
 * contarle al usuario lo mismo.
 *
 * Los códigos vienen de dos sitios y conviene no confundirlos:
 *
 *  - **PostgreSQL** los emite la RPC. `P0001` es el `raise exception` sin
 *    `errcode` explícito, que en este esquema significa siempre *conflicto de
 *    revisión*; `42501` es permiso insuficiente, y es el que usan las guardas
 *    de rol y de sesión; `22023`/`23514` son validación; `23505` es unicidad.
 *  - **PostgREST** los añade en el borde. `PGRST301` es un JWT inválido o
 *    caducado, que para el usuario es lo mismo que un permiso denegado: hay que
 *    volver a entrar.
 *
 * Y una tercera familia que no lleva código: el `TypeError: Failed to fetch`
 * del navegador cuando no hay red. Ese es el único caso `offline`, y es el que
 * decide si el trabajo se guarda como borrador local o se descarta.
 */
import type { PersistenceResult, PersistenceStatus } from './persistenceResult';

/** Conflicto de concurrencia optimista: la revisión esperada ya no es la vigente. */
const CONFLICT_CODES: ReadonlySet<string> = new Set(['P0001', '23505', '40001', '40P01']);
/** Las reglas dijeron que no: rol, sesión, propiedad o token. */
const PERMISSION_CODES: ReadonlySet<string> = new Set(['42501', 'PGRST301', 'PGRST302', '28000']);
/** La forma del dato no cumple el contrato del esquema. */
const VALIDATION_CODES: ReadonlySet<string> = new Set(['22023', '23514', '23502', '23503', '22P02']);
/** No se llegó al servidor. */
const OFFLINE_CODES: ReadonlySet<string> = new Set(['fetch', 'ECONNABORTED', 'ETIMEDOUT', '57014', '08006', '08003']);

const OFFLINE_MESSAGE = /failed to fetch|networkerror|network request failed|load failed|err_internet_disconnected/i;

/** El `code` de un error de PostgREST o de PostgreSQL, si lo trae. */
export const supabaseErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code !== '' ? code : undefined;
};

/**
 * ¿No hay red?
 *
 * Se pregunta aparte porque es la única respuesta que autoriza a guardar un
 * borrador local: un rechazo de las reglas reintentado produce el mismo
 * rechazo, y prometerle al usuario una sincronización que nunca ocurrirá es
 * peor que decirle que no se guardó.
 */
export const isSupabaseOffline = (error: unknown): boolean => {
  const code = supabaseErrorCode(error);
  if (code && OFFLINE_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (OFFLINE_MESSAGE.test(message)) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
};

/** La clasificación canónica de un fallo de Supabase. */
export const classifySupabaseError = (error: unknown): PersistenceStatus => {
  const code = supabaseErrorCode(error);
  if (code && CONFLICT_CODES.has(code)) return 'conflict';
  if (code && PERMISSION_CODES.has(code)) return 'permission-denied';
  if (code && VALIDATION_CODES.has(code)) return 'validation-error';
  if (isSupabaseOffline(error)) return 'offline';
  return 'failed';
};

/** Un error clasificado y con el mensaje del servidor, cuando lo trae. */
export const supabaseErrorMessage = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message !== '' ? message : undefined;
};

/**
 * El envoltorio de un fallo, sin pasar por `executeRemoteWrite`.
 *
 * Para los caminos que atrapan su propio error —un lote que informa por
 * elemento, una degradación a borrador— de modo que produzcan el mismo sobre
 * que todo lo demás en vez de un objeto improvisado.
 */
export const supabaseFailure = <T = never>(
  operationId: string,
  error: unknown,
  message: string,
): PersistenceResult<T> => ({
  status: classifySupabaseError(error),
  success: false,
  operationId,
  target: 'supabase',
  error,
  errorCode: supabaseErrorCode(error),
  message: supabaseErrorMessage(error) ?? message,
});

/**
 * Convierte `{ data, error }` en un valor o en una excepción clasificable.
 *
 * El SDK de Supabase no lanza: devuelve el error dentro del sobre. Un `if
 * (error)` olvidado se lee como una lectura vacía, que es exactamente el modo
 * de fallo que hace que una pantalla informe de un portafolio sin trabajo
 * cuando lo que ocurrió fue un permiso denegado.
 */
export const unwrap = <T>(envelope: { data: T; error: unknown }): T => {
  if (envelope.error) throw envelope.error;
  return envelope.data;
};

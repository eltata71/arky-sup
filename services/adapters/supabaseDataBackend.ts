/**
 * Puerta del backend de datos Supabase (F3.2, cerrada hasta F4/F5).
 *
 * Este fichero existe para que la selección por contexto tenga adónde
 * apuntar sin que ningún repositorio importe hoy un SDK que no está instalado
 * (`@supabase/supabase-js` no es dependencia del proyecto) ni hable con un
 * proyecto remoto desde un corte que aún no existe.
 *
 *  - `isSupabaseDataBackendConfigured`: las dos variables mínimas sin las
 *    cuales ni siquiera se intenta (URL + clave publishable; nunca service
 *    role en el cliente).
 *  - `requireSupabaseDataBackend`: lanza `BackendUnavailableError` siempre,
 *    hasta que el corte correspondiente la implemente contra un
 *    `RepositoryPort`. Que falle aquí —y no con un `fetch` a mitad de un caso
 *    de uso— es la garantía: ningún camino de escritura puede llegar a
 *    Supabase por accidente en F3.
 */
import { BackendUnavailableError } from '../ports';

export function isSupabaseDataBackendConfigured(env: Record<string, string | undefined>): boolean {
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  return url !== '' && key !== '';
}

/** Siempre lanza hasta F4/F5: el backend Supabase aún no tiene repositorios. */
export function requireSupabaseDataBackend(operation: string): never {
  throw new BackendUnavailableError('supabase', operation);
}

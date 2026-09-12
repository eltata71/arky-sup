/**
 * Selección del proveedor de identidad (F4.1).
 *
 * Reutiliza `resolveBackend` para que la decisión sea la misma que la del
 * backend de datos: un solo lugar donde se lee el entorno, un solo lugar donde
 * un typo cae al valor seguro.
 *
 * Mientras un contexto no haya migrado, el valor por defecto es Firebase —el
 * proveedor que hoy atiende de verdad—, así que añadir este módulo no cambia el
 * comportamiento de la aplicación en curso.
 */
import { BackendUnavailableError, type IdentityPort } from '../ports';
import { resolveBackend, type BackendResolution } from './backendSelection';
import { firebaseIdentityAdapter } from './firebaseIdentityAdapter';
import { loadSupabaseIdentityPort } from './supabaseAuthClient';

export function resolveIdentityBackend(
  env: Record<string, string | undefined>,
  context?: string,
): BackendResolution {
  return resolveBackend(env, context);
}

/**
 * Devuelve el puerto de identidad del backend resuelto.
 *
 * El caso `memory` lanza a propósito: existe para pruebas que inyectan su propio
 * puerto, y un despliegue que lo pidiera tendría que saberlo en la primera
 * llamada, no fallar de forma confusa al iniciar sesión.
 */
export async function loadIdentityPort(
  env: Record<string, string | undefined>,
  context?: string,
): Promise<IdentityPort> {
  const { backend } = resolveIdentityBackend(env, context);
  if (backend === 'supabase') return loadSupabaseIdentityPort(env);
  if (backend === 'memory') {
    throw new BackendUnavailableError('memory', 'identity');
  }
  return firebaseIdentityAdapter;
}

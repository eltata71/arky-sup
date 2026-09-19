/**
 * Selección del proveedor de identidad.
 *
 * Reutiliza `resolveBackend` para que la decisión sea la misma que la del
 * backend de datos: un solo lugar donde se lee el entorno, un solo lugar donde
 * un typo cae al valor seguro.
 *
 * Tras F9 hay **un** proveedor —Supabase Auth, ADR-004— y esta función deja de
 * elegir para pasar a *comprobar*: `memory` lanza, porque existe para pruebas
 * que inyectan su propio puerto y un despliegue que lo pidiera debe enterarse en
 * la primera llamada, no fallar de forma confusa al iniciar sesión.
 *
 * El interruptor no se ha borrado con el segundo proveedor, y es una decisión:
 * `BackendKind` sigue nombrando el eje por el que un contexto podría volver a
 * dividirse, y borrarlo obligaría a reinventarlo el día que exista una razón.
 * Lo que sí desapareció es el valor por defecto que apuntaba a otro sitio.
 */
import { BackendUnavailableError, type IdentityPort } from '../ports';
import { resolveBackend, type BackendResolution } from './backendSelection';
import { loadSupabaseIdentityPort } from './supabaseAuthClient';

export function resolveIdentityBackend(
  env: Record<string, string | undefined>,
  context?: string,
): BackendResolution {
  return resolveBackend(env, context);
}

/** Devuelve el puerto de identidad del backend resuelto. */
export async function loadIdentityPort(
  env: Record<string, string | undefined>,
  context?: string,
): Promise<IdentityPort> {
  const { backend } = resolveIdentityBackend(env, context);
  if (backend === 'memory') throw new BackendUnavailableError('memory', 'identity');
  return loadSupabaseIdentityPort(env);
}

/**
 * Selección de backend por contexto.
 *
 * Función pura sobre variables de entorno, sin SDK ni red: se prueba sin
 * emulador y se decide sin desplegar.
 *
 *  - `VITE_BACKEND`: `supabase` (el proveedor único desde F9). `memory` solo
 *    existe para pruebas y nunca sale de ellas.
 *  - `VITE_BACKEND_<CONTEXTO>`: override por contexto, que es lo que permitió a
 *    F5 migrar un corte vertical cada vez sin arrastrar al resto.
 *
 * **F9 retiró Firebase, y con él el valor por defecto que apuntaba a otro
 * sitio.** Lo que queda es la forma, no la elección: un valor desconocido no
 * lanza, cae a `supabase`, porque un typo en una variable no puede cambiar el
 * proveedor de datos en silencio — y ahora, además, no hay ningún otro sitio
 * donde pudiera caer. `resolved` dice si la petición se honró tal cual, para
 * que el arranque lo registre en observabilidad en vez de adivinarlo.
 *
 * El eje se conserva a propósito. Borrarlo obligaría a reinventarlo el día que
 * un contexto tenga una razón real para vivir en otro sitio, y esa razón
 * llegaría junto con la prisa.
 */
export type BackendKind = 'supabase' | 'memory';

export const DEFAULT_BACKEND: BackendKind = 'supabase';

const KNOWN_BACKENDS: ReadonlySet<string> = new Set(['supabase', 'memory']);

export interface BackendResolution {
  backend: BackendKind;
  /** `false` cuando el valor pedido era desconocido y se aplicó el seguro. */
  resolved: boolean;
  /** Solo presente cuando hay override por contexto. */
  context?: string;
}

const normalize = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

const toBackend = (value: string): BackendKind => (value === 'memory' ? 'memory' : 'supabase');

export function resolveBackend(
  env: Record<string, string | undefined>,
  context?: string,
): BackendResolution {
  const global = normalize(env.VITE_BACKEND);
  if (context) {
    const override = normalize(env[`VITE_BACKEND_${context.trim().toUpperCase()}`]);
    if (override !== '') {
      const known = KNOWN_BACKENDS.has(override);
      return { backend: known ? toBackend(override) : DEFAULT_BACKEND, resolved: known, context };
    }
  }
  if (global === '') return { backend: DEFAULT_BACKEND, resolved: true };
  const known = KNOWN_BACKENDS.has(global);
  return { backend: known ? toBackend(global) : DEFAULT_BACKEND, resolved: known };
}

/** True solo cuando el backend pedido es el que se resolvió. */
export function isBackendHonored(resolution: BackendResolution): boolean {
  return resolution.resolved;
}

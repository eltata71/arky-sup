/**
 * Selección de backend por contexto (F3.2).
 *
 * Función pura sobre variables de entorno, sin SDK ni red: se prueba sin
 * emulador y se decide sin desplegar.
 *
 *  - `VITE_BACKEND`: `firebase` (por defecto, el proveedor activo) o
 *    `supabase` cuando un corte F5 lo habilite. `memory` solo existe para
 *    pruebas y nunca sale de ellas.
 *  - `VITE_BACKEND_<CONTEXTO>`: override por contexto
 *    (`businessInitiatives`, `architectureProjects`, `architectureOffice`,
 *    `artifacts`, `publication`, `knowledge`, `learning`), para que cada
 *    corte vertical migre sin arrastrar al resto.
 *
 * Un valor desconocido no lanza: cae al valor seguro (`firebase`) porque un
 * typo en una variable no puede cambiar el proveedor de datos en silencio.
 * `resolved` dice si la petición se honró tal cual, para que el arranque lo
 * registre en observabilidad en vez de adivinarlo.
 */
export type BackendKind = 'firebase' | 'supabase' | 'memory';

export const DEFAULT_BACKEND: BackendKind = 'firebase';

const KNOWN_BACKENDS: ReadonlySet<string> = new Set(['firebase', 'supabase', 'memory']);

export interface BackendResolution {
  backend: BackendKind;
  /** `false` cuando el valor pedido era desconocido y se aplicó el seguro. */
  resolved: boolean;
  /** Solo presente cuando hay override por contexto. */
  context?: string;
}

const normalize = (value: string | undefined): string => (value ?? '').trim().toLowerCase();

const toBackend = (value: string): BackendKind => {
  if (value === 'supabase' || value === 'memory') return value;
  return 'firebase';
};

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

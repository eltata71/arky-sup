/**
 * `services/adapters` — dónde viven los SDK (F3.2, ampliado en F4.1).
 *
 * Regla: el dominio importa puertos (`services/ports`); los SDK solo se
 * importan aquí y en los repositorios de contexto ya listados en
 * `eslint.config.js`. Un adaptador nuevo se añade a esa lista en revisión,
 * nunca por conveniencia.
 *
 * El SDK de Supabase se carga de forma **dinámica** desde
 * `supabaseAuthClient.ts`: no entra en la carga inicial de la aplicación.
 */
export type { BackendKind, BackendResolution } from './backendSelection';
export { DEFAULT_BACKEND, isBackendHonored, resolveBackend } from './backendSelection';
export { firebaseIdentityAdapter } from './firebaseIdentityAdapter';
export { loadIdentityPort, resolveIdentityBackend } from './identityBackend';
export {
  isSupabaseDataBackendConfigured,
  loadSupabaseDataClient,
  requireSupabaseDataBackend,
  type SupabaseDataClientLike,
} from './supabaseDataBackend';
export {
  classifySupabaseAuthError,
  createSupabaseIdentityAdapter,
  sessionIdFromAccessToken,
  toAuthSession,
  type SupabaseAuthClientLike,
  type SupabaseSessionLike,
} from './supabaseIdentityAdapter';
export { loadSupabaseAuthClient, loadSupabaseIdentityPort, resetSupabaseAuthClientCache } from './supabaseAuthClient';

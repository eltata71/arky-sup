/**
 * `services/adapters` — dónde viven los SDK (F3.2).
 *
 * Regla: el dominio importa puertos (`services/ports`); los SDK solo se
 * importan aquí y en los repositorios de contexto ya listados en
 * `eslint.config.js`. Un adaptador nuevo se añade a esa lista en revisión,
 * nunca por conveniencia.
 */
export type { BackendKind, BackendResolution } from './backendSelection';
export { DEFAULT_BACKEND, isBackendHonored, resolveBackend } from './backendSelection';
export { firebaseIdentityAdapter } from './firebaseIdentityAdapter';
export { isSupabaseDataBackendConfigured, requireSupabaseDataBackend } from './supabaseDataBackend';

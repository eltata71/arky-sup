/**
 * `services/adapters` — dónde viven los SDK (F3.2, ampliado en F4.1).
 *
 * Regla: el dominio importa puertos (`services/ports`); el SDK solo se importa
 * aquí. Un adaptador nuevo se añade a la lista de `eslint.config.js` en
 * revisión, nunca por conveniencia.
 *
 * El SDK de Supabase se carga de forma **dinámica**, en `supabaseAuthClient.ts`
 * y en `supabaseDataBackend.ts`: no entra en la carga inicial de la aplicación.
 * Tras F9 no queda un segundo proveedor, así que `resolveBackend` conserva
 * `memory` sólo para pruebas.
 */
export type { BackendKind, BackendResolution } from './backendSelection';
export { DEFAULT_BACKEND, isBackendHonored, resolveBackend } from './backendSelection';
export { loadIdentityPort, resolveIdentityBackend } from './identityBackend';
export {
  callRpc,
  isSupabaseDataBackendConfigured,
  loadSupabaseDataClient,
  resetSupabaseDataClientCache,
  type SupabaseDataClientLike,
} from './supabaseDataBackend';
export {
  BUCKET_FOR,
  createSupabaseFileStorage,
  extensionFor,
  folderFor,
  loadFileStorage,
  resetFileStorageCache,
  sha256Hex,
  type StorageContext,
  type StorageObjectDescriptor,
  type SupabaseFileStorage,
  type SupabaseStorageClientLike,
} from './supabaseFileStorage';
export {
  classifySupabaseAuthError,
  createSupabaseIdentityAdapter,
  sessionIdFromAccessToken,
  toAuthSession,
  type SupabaseAuthClientLike,
  type SupabaseSessionLike,
} from './supabaseIdentityAdapter';
export { loadSupabaseAuthClient, loadSupabaseIdentityPort, resetSupabaseAuthClientCache } from './supabaseAuthClient';

/**
 * `services/ports` — contratos del dominio con el exterior (F3.1).
 *
 * El dominio importa de aquí; los SDK viven en `services/adapters` y en los
 * repositorios de cada contexto. Ningún import de este barril alcanza a
 * React, Firebase o Supabase.
 */
export type {
  ClockPort,
  FileStoragePort,
  IdentityPort,
  RepositoryPort,
  StoredFile,
} from './ports';
export { BackendUnavailableError, SystemClock } from './ports';
export { ManualClock, MemoryFileStorage, MemoryRepository } from './memory';

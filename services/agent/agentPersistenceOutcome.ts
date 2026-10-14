import type { Artifact } from '../../lib/artifacts';
import type { PersistenceResult } from '../persistence';

/** Adapter for synchronous test stores. Real app stores return the envelope. */
export const confirmedResult = (value: PersistenceResult<Artifact> | Artifact | void): PersistenceResult<Artifact> => {
  if (value && 'status' in value && 'success' in value) return value as PersistenceResult<Artifact>;
  return {
    status: 'success', success: true, target: 'memory', operationId: 'legacy-test-double',
    data: value as Artifact | undefined,
  };
};

export const persistenceFailureMessage = (result: PersistenceResult<Artifact>): string => {
  if (result.status === 'offline') return 'Guardado sólo en este navegador; la base de datos aún no confirmó los cambios.';
  if (result.status === 'conflict') return 'No pude guardar: otra versión cambió en la base de datos. Recarga y revisa antes de reintentar.';
  return result.message ?? 'No pude guardar los cambios. Reintenta en unos segundos.';
};

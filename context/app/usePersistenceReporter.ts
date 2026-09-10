/**
 * One place that says whether the last write reached the database.
 *
 * Every mutation in this context reports through here, and
 * `components/PersistenceStatusBanner.tsx` is what the user sees of it. It is
 * its own hook because the alternative — each operation setting two pieces of
 * state inline — is how `trainingService` ended up telling a trainer their
 * course was saved when it only reached `localStorage`.
 *
 * `handleWriteResult` returns whether the write is confirmed, so callers can
 * roll their optimistic update back on `false` in one line.
 */

import { useCallback, useState } from 'react';
import type { PersistenceResult } from '../../services/persistence';
import { isWriteConfirmed } from '../../services/persistence';
import type { PersistenceStatus } from './appContextTypes';

export interface PersistenceReporter {
  readonly persistenceStatus: PersistenceStatus;
  readonly persistenceMessage: string | null;
  readonly setPersistenceStatus: (status: PersistenceStatus) => void;
  readonly setPersistenceMessage: (message: string | null) => void;
  readonly handleWriteResult: (result: PersistenceResult<unknown>, successMessage: string) => boolean;
}

export const usePersistenceReporter = (): PersistenceReporter => {
  const [persistenceStatus, setPersistenceStatus] = useState<PersistenceStatus>('ready');
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null);

  const handleWriteResult = useCallback((result: PersistenceResult<unknown>, successMessage: string): boolean => {
    if (isWriteConfirmed(result)) {
      setPersistenceStatus('ready');
      setPersistenceMessage(successMessage);
      return true;
    }
    setPersistenceStatus(result.status === 'offline' ? 'degraded' : 'error');
    setPersistenceMessage(result.message ?? 'No se pudo guardar en la base de datos.');
    return false;
  }, []);

  return {
    persistenceStatus,
    persistenceMessage,
    setPersistenceStatus,
    setPersistenceMessage,
    handleWriteResult,
  };
};

/**
 * One place where a Training Center write is judged.
 *
 * There are sixteen write call sites in `LMSContext` and every one of them
 * used to be fire-and-forget, because `trainingService` resolved successfully
 * whether the data reached the database or only `localStorage`. Now each write
 * returns a `PersistenceResult`, and this is the single funnel that turns a
 * non-confirmed one into something a person can see. Routing them all through
 * here is what keeps the count at one: a seventeenth call site cannot forget to
 * report, because not calling `trackWrite` is visible in review.
 *
 * It lives in a hook rather than inside the provider for the ordinary reason —
 * `LMSContext` is a state container and this is a persistence concern — and for
 * a mechanical one: the module-size budget refused the provider at 551 lines,
 * and the honest answer to that is to move a capability out, not to raise the
 * ceiling.
 */
import { useCallback, useState } from 'react';
import { type TrainingWriteResult } from '../services/learning';
import { isWriteConfirmed } from '../services/persistence';

const GENERIC_FAILURE = 'No se pudo sincronizar con la base de datos.';

export interface TrainingSync {
  /** The message to show, or `null` when the last write was confirmed. */
  syncError: string | null;
  /** Judge one write. Fire-and-forget by design: the caller does not await. */
  trackWrite: (write: Promise<TrainingWriteResult>) => void;
  /**
   * Report something the writes cannot see — today, the initial load falling
   * back to the local cache. Passing `null` clears the notice.
   *
   * It is here rather than a second `useState` in the provider so the banner
   * has one owner: two independent sources writing the same message would race
   * and the last one to resolve would win, silently.
   */
  reportSyncIssue: (message: string | null) => void;
}

export const useTrainingSync = (): TrainingSync => {
  const [syncError, setSyncError] = useState<string | null>(null);

  const trackWrite = useCallback((write: Promise<TrainingWriteResult>) => {
    write
      .then(result => {
        // A confirmed write clears the notice: the connection working again is
        // exactly what the user needs to know after having seen it fail.
        setSyncError(isWriteConfirmed(result) ? null : (result.message ?? GENERIC_FAILURE));
      })
      .catch(error => {
        // A rejected promise is a failure the service did not classify — a
        // programming error or a transport that never reached it. It still
        // means the data is not saved, so it is still reported.
        console.error(error);
        setSyncError(GENERIC_FAILURE);
      });
  }, []);

  return { syncError, trackWrite, reportSyncIssue: setSyncError };
};

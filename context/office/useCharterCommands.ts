/**
 * Las tres operaciones del Office que firma una persona sobre un encargo ya
 * leído: aprobar el charter, pedirle cambios y confirmar una revisión que el
 * especialista no llegó a hacer (plan de agentes, 17.1). Salieron de
 * `OfficeContext` cuando éste llegó a su techo de tamaño; cada una lee el
 * encargo, delega la regla en su operación y no decide nada.
 */
import { useCallback } from 'react';
// Sólo tipos, por la puerta: las operaciones las pasa `OfficeContext`, que ya
// las importa, para no abrir otro import profundo hacia la Oficina.
import type {
  EngagementOperationDeps,
  OfficeActor,
  OfficeEngagement,
  OfficeOperationResult,
} from '../../services/architectureOffice';

type Operation<Args extends unknown[]> = (
  deps: EngagementOperationDeps,
  engagement: OfficeEngagement,
  ...args: Args
) => Promise<OfficeOperationResult>;

export interface CharterOperations {
  approveCharterOperation: Operation<[actor: OfficeActor]>;
  requestCharterChangesOperation: Operation<[actor: OfficeActor, reason: string]>;
  confirmReviewOperation: Operation<[taskId: string, actor: OfficeActor]>;
}

const MISSING: OfficeOperationResult = { ok: false, reason: 'El encargo no existe.' };

export const useCharterCommands = (
  readEngagement: (engagementId: string) => OfficeEngagement | undefined,
  actor: OfficeActor,
  operationDeps: EngagementOperationDeps,
  { approveCharterOperation, requestCharterChangesOperation, confirmReviewOperation }: CharterOperations,
) => {
  const approveCharter = useCallback(async (engagementId: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    return engagement ? approveCharterOperation(operationDeps, engagement, actor) : MISSING;
  }, [readEngagement, actor, operationDeps]);

  const requestCharterChanges = useCallback(async (engagementId: string, reason: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    return engagement ? requestCharterChangesOperation(operationDeps, engagement, actor, reason) : MISSING;
  }, [readEngagement, actor, operationDeps]);

  const confirmReview = useCallback(async (engagementId: string, taskId: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    return engagement ? confirmReviewOperation(operationDeps, engagement, taskId, actor) : MISSING;
  }, [readEngagement, actor, operationDeps]);

  return { approveCharter, requestCharterChanges, confirmReview };
};

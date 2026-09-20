/**
 * How this product writes, and what it says when a write does not land.
 *
 * `PersistenceResult` was already the shared envelope; what was missing was a
 * module around it. The classification lived in `services/persistence.ts` and
 * the *degradation* — keep the value locally, report it as pending — lived in
 * two private methods of `firestoreService`, out of reach of every repository.
 *
 * **F9 removed the second backend.** Until this phase the envelope was shaped
 * by Firebase: `FirebaseError`, `isFirebaseAvailable`, a `requireDb` that
 * handed out a `Firestore`. Those are gone with the SDK, and what replaces them
 * is the same shape over PostgreSQL: the classification is
 * `classifySupabaseError` (`services/persistence/supabaseErrors.ts`) and the
 * availability check asks whether this deployment has a Supabase URL and a
 * publishable key.
 *
 * Two things deliberately did **not** change with the provider, because they
 * are product decisions rather than SDK details:
 *
 *  - `writeLocalDraft` is still the one correct way to degrade, and it still
 *    returns `success: false`. A local draft is not a saved document.
 *  - Only `offline` earns a draft. A rejection by RLS retried is the same
 *    rejection, and keeping a draft of something the caller may not write
 *    promises a synchronisation that will never happen.
 */
import { observabilityService } from '../observability';
import { classifySupabaseError, supabaseErrorCode } from './supabaseErrors';

export type PersistenceStatus =
  | 'success'
  | 'failed'
  | 'permission-denied'
  | 'offline'
  | 'conflict'
  | 'validation-error';

export type PersistenceTarget = 'supabase' | 'local-draft' | 'memory';

export interface PersistenceResult<T = unknown> {
  status: PersistenceStatus;
  success: boolean;
  operationId: string;
  target: PersistenceTarget;
  data?: T;
  error?: unknown;
  errorCode?: string;
  message?: string;
  conflict?: { remoteUpdatedAt?: string; expectedUpdatedAt?: string };
}

export interface PersistenceOperationContext {
  operationName: string;
  userId?: string;
  projectId?: string;
  artifactId?: string;
  target?: PersistenceTarget;
}

export class PersistenceError extends Error {
  public readonly result: PersistenceResult;

  constructor(result: PersistenceResult) {
    super(result.message ?? `Persistence operation ${result.operationId} failed with status ${result.status}`);
    this.name = 'PersistenceError';
    this.result = result;
  }
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const createOperationId = (operationName: string): string => {
  const safeName = operationName.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `${safeName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const getErrorCode = (error: unknown): string | undefined => supabaseErrorCode(error);

/**
 * Lets specific persistence failures surface their own actionable Spanish
 * message instead of the generic `buildUserMessage` text. Errors opt in by
 * exposing a string `userMessage` property (see `PersistenceValidationError`).
 */
const getCustomUserMessage = (error: unknown): string | null => {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { userMessage?: unknown }).userMessage;
  return typeof value === 'string' && value.length > 0 ? value : null;
};

export const classifyPersistenceError = (error: unknown): PersistenceStatus => classifySupabaseError(error);

/**
 * ¿Tiene este despliegue un backend al que escribir?
 *
 * Sustituye a `assertFirebaseAvailable`, y responde la misma pregunta: sin
 * configuración no hay persistencia remota, y decirlo antes de intentar la
 * escritura es lo que distingue «no está configurado» de «la red falló». El
 * entorno se lee por parámetro para que la función siga siendo pura y se pueda
 * probar sin tocar `import.meta.env`.
 */
export const assertBackendConfigured = (
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): PersistenceResult<void> => {
  const url = (env.VITE_SUPABASE_URL ?? '').trim();
  const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  if (url !== '' && key !== '') {
    return {
      status: 'success',
      success: true,
      operationId: createOperationId('assertBackendConfigured'),
      target: 'supabase',
    };
  }

  return {
    status: 'validation-error',
    success: false,
    operationId: createOperationId('assertBackendConfigured'),
    target: 'supabase',
    errorCode: 'supabase/not-configured',
    message: 'La configuración de Supabase está incompleta. La persistencia remota está deshabilitada.',
  };
};

export async function executeRemoteWrite<T>(
  context: PersistenceOperationContext,
  write: () => Promise<T>,
): Promise<PersistenceResult<T>> {
  const operationId = createOperationId(context.operationName);
  const startedAt = now();
  const target = context.target ?? 'supabase';
  const metadata = {
    operationId,
    userId: context.userId,
    projectId: context.projectId,
    artifactId: context.artifactId,
    persistenceTarget: target,
  };

  const availability = assertBackendConfigured();
  if (!availability.success) {
    const durationMs = Math.round(now() - startedAt);
    const result: PersistenceResult<T> = {
      status: availability.status,
      success: false,
      operationId,
      target,
      errorCode: availability.errorCode,
      message: availability.message,
    };
    observabilityService.reportError(new PersistenceError(result), {
      source: 'operation',
      title: 'Supabase no configurado',
      message: result.message,
      operationId,
      operationName: context.operationName,
      severity: 'critical',
      recoverable: false,
      userVisible: true,
      metadata: { ...metadata, remoteStatus: result.status, errorCode: result.errorCode, durationMs },
    });
    return result;
  }

  try {
    const data = await write();
    const durationMs = Math.round(now() - startedAt);
    observabilityService.trackEvent({
      source: 'operation',
      severity: 'success',
      status: 'succeeded',
      title: 'Persistencia remota confirmada',
      message: `${context.operationName} fue confirmado por Supabase.`,
      operationId,
      operationName: context.operationName,
      recoverable: true,
      userVisible: false,
      metadata: { ...metadata, remoteStatus: 'success', durationMs },
    });
    return { status: 'success', success: true, operationId, target, data };
  } catch (error) {
    const status = classifyPersistenceError(error);
    const errorCode = getErrorCode(error);
    const durationMs = Math.round(now() - startedAt);
    const customMessage = getCustomUserMessage(error);
    const result: PersistenceResult<T> = {
      status,
      success: false,
      operationId,
      target,
      error,
      errorCode,
      message: customMessage ?? buildUserMessage(status, context.operationName),
    };
    observabilityService.reportError(error, {
      source: 'operation',
      title: buildTitle(status),
      message: result.message,
      operationId,
      operationName: context.operationName,
      severity: status === 'permission-denied' || status === 'validation-error' ? 'critical' : status === 'offline' ? 'warning' : 'error',
      recoverable: status === 'offline' || status === 'conflict',
      userVisible: true,
      metadata: { ...metadata, remoteStatus: status, errorCode, durationMs },
    });
    return result;
  }
}

export const buildTitle = (status: PersistenceStatus): string => {
  switch (status) {
    case 'permission-denied': return 'Permiso denegado por las políticas de la base de datos';
    case 'offline': return 'Sin conexión: operación no confirmada';
    case 'conflict': return 'Conflicto de concurrencia detectado';
    case 'validation-error': return 'Persistencia bloqueada por validación/configuración';
    case 'success': return 'Persistencia confirmada';
    case 'failed':
    default: return 'No se pudo guardar en la base de datos';
  }
};

export const buildUserMessage = (status: PersistenceStatus, operationName: string): string => {
  switch (status) {
    case 'permission-denied':
      return `No se pudo guardar en la base de datos: Supabase rechazó ${operationName} por permisos o por una sesión no activa.`;
    case 'offline':
      return `${operationName} no fue confirmado por Supabase porque no hay conexión. Queda como borrador local/offline pendiente.`;
    case 'conflict':
      return `${operationName} detectó cambios remotos concurrentes. Recarga o fusiona los cambios antes de sobrescribir.`;
    case 'validation-error':
      return `${operationName} no puede ejecutarse: configuración o datos inválidos.`;
    case 'failed':
    default:
      return `No se pudo guardar en la base de datos durante ${operationName}.`;
  }
};

export const isWriteConfirmed = (result: PersistenceResult<unknown>): boolean => result.success && result.status === 'success';

/**
 * A failed write, classified, without going through `executeRemoteWrite`.
 *
 * For the paths that catch their own error — a local-draft fallback, a batch
 * that reports per item — so they produce the same envelope as everything else
 * instead of an ad-hoc object.
 */
export const createFailureResult = <T = never>(
  operationName: string,
  error: unknown,
): PersistenceResult<T> => ({
  status: classifyPersistenceError(error),
  success: false,
  operationId: createOperationId(operationName),
  target: 'supabase',
  error,
  errorCode: getErrorCode(error),
  message: error instanceof Error ? error.message : String(error),
});

/* ── Errores de seguridad ─────────────────────────────────────────────────── */
/**
 * Los códigos que significan «las reglas dijeron que no», y no «la red falló».
 *
 * Distinguirlos importa porque la respuesta es distinta: un fallo de red se
 * degrada a borrador local y se reintenta, y un rechazo del servidor no —
 * reintentarlo sólo produce el mismo rechazo, y guardar un borrador de algo que
 * el usuario no tiene permiso para escribir es prometerle una sincronización
 * que nunca va a ocurrir.
 */
export const isSecurityError = (error: unknown): boolean =>
  classifySupabaseError(error) === 'permission-denied';

export const isOfflineError = (error: unknown): boolean => classifyPersistenceError(error) === 'offline';

/** Lo que se lanza cuando el servidor rechaza una operación con nombre. */
export class PermissionDeniedError extends Error {
  public readonly code = '42501' as const;

  constructor(operation: string, cause?: unknown) {
    const causeMsg = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Operación "${operation}" rechazada por las políticas de seguridad${causeMsg}.`);
    this.name = 'PermissionDeniedError';
  }
}

/**
 * Convierte un resultado no confirmado en una excepción.
 *
 * Para los caminos que componen varias escrituras y no pueden seguir si una no
 * llegó: propagar es correcto ahí, mientras que devolver el envoltorio dejaría
 * al llamador con medio agregado escrito y ninguna señal.
 */
export const ensureConfirmed = (result: PersistenceResult<unknown>): void => {
  if (!isWriteConfirmed(result)) throw new PersistenceError(result);
};

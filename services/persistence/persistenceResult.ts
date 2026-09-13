import { FirebaseError } from 'firebase/app';
import { isFirebaseAvailable } from '../../firebase';
import { observabilityService } from '../observability';
import type { Firestore } from 'firebase/firestore';

export type PersistenceStatus =
  | 'success'
  | 'failed'
  | 'permission-denied'
  | 'offline'
  | 'conflict'
  | 'validation-error';

export type PersistenceTarget = 'firestore' | 'supabase' | 'local-draft' | 'memory';

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

const FIREBASE_SECURITY_CODES = new Set(['permission-denied', 'unauthenticated']);
const FIREBASE_CONFLICT_CODES = new Set(['aborted', 'already-exists']);
const FIREBASE_VALIDATION_CODES = new Set(['invalid-argument', 'failed-precondition', 'out-of-range']);
const FIREBASE_OFFLINE_CODES = new Set(['unavailable', 'deadline-exceeded', 'cancelled']);

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export const createOperationId = (operationName: string): string => {
  const safeName = operationName.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  return `${safeName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const getErrorCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== 'object') return undefined;
  const maybeCode = (error as Partial<FirebaseError> & { code?: unknown }).code;
  return typeof maybeCode === 'string' ? maybeCode : undefined;
};

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

export const classifyPersistenceError = (error: unknown): PersistenceStatus => {
  const code = getErrorCode(error);
  if (code && FIREBASE_SECURITY_CODES.has(code)) return 'permission-denied';
  if (code && FIREBASE_CONFLICT_CODES.has(code)) return 'conflict';
  if (code && FIREBASE_VALIDATION_CODES.has(code)) return 'validation-error';
  if (code && FIREBASE_OFFLINE_CODES.has(code)) return 'offline';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return 'failed';
};

export const assertFirebaseAvailable = (): PersistenceResult<void> => {
  if (isFirebaseAvailable) {
    return {
      status: 'success',
      success: true,
      operationId: createOperationId('assertFirebaseAvailable'),
      target: 'firestore',
    };
  }

  return {
    status: 'validation-error',
    success: false,
    operationId: createOperationId('assertFirebaseAvailable'),
    target: 'firestore',
    errorCode: 'firebase/not-configured',
    message: 'La configuración de Firebase está incompleta. La persistencia remota está deshabilitada.',
  };
};

export async function executeRemoteWrite<T>(
  context: PersistenceOperationContext,
  write: () => Promise<T>,
): Promise<PersistenceResult<T>> {
  const operationId = createOperationId(context.operationName);
  const startedAt = now();
  const target = context.target ?? 'firestore';
  const metadata = {
    operationId,
    userId: context.userId,
    projectId: context.projectId,
    artifactId: context.artifactId,
    persistenceTarget: target,
  };

  const availability = assertFirebaseAvailable();
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
      title: 'Firebase no configurado',
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
      message: `${context.operationName} fue confirmado por Firestore.`,
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
    case 'permission-denied': return 'Permiso denegado por reglas de Firestore';
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
      return `No se pudo guardar en la base de datos: Firestore rechazó ${operationName} por permisos.`;
    case 'offline':
      return `${operationName} no fue confirmado por Firestore porque no hay conexión. Queda como borrador local/offline pendiente.`;
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
 * instead of an ad-hoc object. It lived privately inside `firestoreService`,
 * which is why the repositories outside that file each shaped their own.
 */
export const createFailureResult = <T = never>(
  operationName: string,
  error: unknown,
): PersistenceResult<T> => ({
  status: classifyPersistenceError(error),
  success: false,
  operationId: createOperationId(operationName),
  target: 'firestore',
  error,
  errorCode: getErrorCode(error),
  message: error instanceof Error ? error.message : String(error),
});

/* ── Errores de seguridad ─────────────────────────────────────────────────── */
/**
 * Los códigos que significan «las reglas dijeron que no», y no «la red falló».
 *
 * Distinguirlos importa porque la respuesta es distinta: un fallo de red se
 * degrada a borrador local y se reintenta, y un rechazo de las reglas no —
 * reintentarlo sólo produce el mismo rechazo, y guardar un borrador de algo que
 * el usuario no tiene permiso para escribir es prometerle una sincronización
 * que nunca va a ocurrir.
 *
 * Vivían dentro de `services/firestoreService.ts`, que es donde estaba el único
 * código que hablaba con Firestore. Al repartirlo por contextos pasan aquí, que
 * es donde el resto de la clasificación de errores ya vivía.
 */
const SECURITY_ERROR_CODES: ReadonlySet<string> = new Set([
  'permission-denied',
  'unauthenticated',
  'failed-precondition',
]);

export const isSecurityError = (error: unknown): boolean => {
  const code = getErrorCode(error);
  return typeof code === 'string' && SECURITY_ERROR_CODES.has(code);
};

export const isOfflineError = (error: unknown): boolean => classifyPersistenceError(error) === 'offline';

/** Lo que se lanza cuando las reglas rechazan una operación con nombre. */
export class PermissionDeniedError extends Error {
  public readonly code = 'permission-denied' as const;

  constructor(operation: string, cause?: unknown) {
    const causeMsg = cause instanceof Error ? `: ${cause.message}` : '';
    super(`Operación "${operation}" rechazada por reglas de seguridad${causeMsg}.`);
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

/* ── El acceso a la base de datos ─────────────────────────────────────────── */
/**
 * `db` no siempre existe, y el `strict` de la Ola 2 lo dijo en voz alta.
 *
 * `firebase.ts` exporta `Firestore | null`: cuando las variables `VITE_FIREBASE_*`
 * no están puestas, la aplicación arranca igual y funciona contra
 * `localStorage`. Todos los repositorios escribían `doc(db, …)` como si nunca
 * fuera nulo, y sólo se libraban porque `strictNullChecks` estaba apagado en
 * esos ficheros.
 *
 * En el camino de escritura no llegaba a doler: `executeRemoteWrite` llama a
 * `assertFirebaseAvailable` antes. En el de **lectura** sí — `doc(null, …)`
 * lanza un `TypeError` que el `catch` de turno convertía en «no se pudo leer»,
 * sin decir que la causa era una configuración ausente y no la red.
 *
 * Esta función devuelve el `Firestore` o lanza un error clasificable, que es lo
 * que `classifyPersistenceError` sabe convertir en el estado correcto.
 */
export const requireDb = (database: Firestore | null): Firestore => {
  if (!database) {
    const error = new Error(
      'Firestore no está configurado en este despliegue; no hay persistencia remota.',
    ) as Error & { code: string };
    error.code = 'unavailable';
    throw error;
  }
  return database;
};

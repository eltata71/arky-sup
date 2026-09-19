/**
 * `services/ports` — los contratos que el dominio necesita del mundo exterior.
 *
 * Ningún fichero de este módulo importa React, Supabase ni ningún SDK: son
 * interfaces TypeScript puras más errores tipados. Eso es lo que permite probar
 * el dominio sin montar un árbol de React ni arrancar una base de datos, que es
 * la salida declarada de F3.
 *
 * Cada puerto tiene su adaptador:
 *  - identidad → `services/adapters/supabaseIdentityAdapter.ts`.
 *  - reloj → `SystemClock` aquí mismo (no necesita adaptador).
 *  - archivos → `services/adapters/supabaseFileStorage.ts`.
 *  - repositorio → un adaptador por contexto sobre `services/persistence`.
 *
 * Que estas interfaces sobrevivieran al cambio de proveedor sin un solo cambio
 * es la prueba de que valían la pena: F9 sustituyó Firebase por Supabase debajo
 * y el dominio no se enteró.
 */

/** Lo mínimo que el dominio necesita saber de quién llama. */
export interface IdentityPort {
  /** UID actual o `null` sin sesión. Nunca lanza. */
  currentUserId(): string | null;
  /** Suscribe cambios de sesión; devuelve la baja. Nunca lanza. */
  observeUserId(listener: (userId: string | null) => void): () => void;
  /**
   * La sesión vigente, o `null` si no hay ninguna.
   *
   * Devuelve el vencimiento en lugar de esconderlo: una decisión de negocio
   * (¿se puede aprobar un encargo con esta sesión?) no puede depender de que el
   * SDK renueve por detrás sin que nadie lo sepa.
   */
  getSession(): Promise<AuthSession | null>;
  /** Inicia sesión con credenciales propias del producto. */
  signInWithPassword(email: string, password: string): Promise<AuthSession>;
  /** Cierra la sesión. Idempotente: sin sesión no hace nada ni falla. */
  signOut(): Promise<void>;
  /** Solicita el restablecimiento de contraseña. No revela si la cuenta existe. */
  requestPasswordReset(email: string): Promise<void>;
}

/**
 * Una sesión autenticada, con lo que hace falta para decidir si sigue siendo
 * utilizable.
 *
 * `sessionId` es `null` cuando el proveedor no expone un identificador de
 * sesión. Se declara explícitamente en vez de fabricar uno: un id inventado no
 * sirve para validar revocación en el servidor, y creer que sí lo haría es peor
 * que saber que no existe.
 */
export interface AuthSession {
  userId: string;
  sessionId: string | null;
  /** Vencimiento absoluto del token de acceso, en milisegundos epoch. */
  expiresAtMs: number;
  /** Vencimiento del refresh, o `null` si el proveedor no lo expone. */
  refreshExpiresAtMs: number | null;
}

/** Por qué falló una operación de identidad. */
export type IdentityFailureReason =
  | 'invalid-credentials'
  | 'unavailable'
  | 'rate-limited'
  | 'unexpected';

/** Error de identidad con causa clasificada, para que la UI no adivine. */
export class IdentityError extends Error {
  public readonly reason: IdentityFailureReason;

  constructor(reason: IdentityFailureReason, message?: string) {
    super(message ?? `Operación de identidad fallida: ${reason}.`);
    this.name = 'IdentityError';
    this.reason = reason;
  }
}

/**
 * ¿Sirve esta sesión para una operación sensible, en este instante?
 *
 * Falla cerrado: sin sesión, sin vencimiento válido o ya vencida, la respuesta
 * es que no. `skewMs` absorbe la diferencia de reloj entre cliente y servidor
 * sin convertirla en una sesión eterna.
 */
export function isSessionUsable(
  session: AuthSession | null | undefined,
  nowMs: number,
  skewMs = 30_000,
): boolean {
  if (!session) return false;
  if (!Number.isFinite(session.expiresAtMs)) return false;
  if (typeof session.userId !== 'string' || session.userId === '') return false;
  return session.expiresAtMs - skewMs > nowMs;
}

/** Reloj inyectable: el dominio no lee `Date` directamente. */
export interface ClockPort {
  nowIso(): string;
  nowMs(): number;
}

/** Archivo binario con identidad verificable (el checksum lo pone F6). */
export interface StoredFile {
  bucket: string;
  path: string;
  bytes: Uint8Array;
  mimeType: string;
}

/**
 * Almacenamiento de archivos por contexto.
 *
 * No devuelve URLs públicas ni firma descargas: eso es política de acceso y
 * vive en el adaptador (F6), no en el contrato.
 */
export interface FileStoragePort {
  upload(bucket: string, path: string, bytes: Uint8Array, mimeType: string): Promise<StoredFile>;
  download(bucket: string, path: string): Promise<Uint8Array>;
  remove(bucket: string, path: string): Promise<void>;
}

/**
 * Repositorio genérico por agregado.
 *
 * `write` es upsert idempotente por id: repetirla con la misma entidad no
 * duplica, lo que la hace apta para reintentos y para la ETL de F5.
 */
export interface RepositoryPort<T, ID extends string = string> {
  read(id: ID): Promise<T | null>;
  write(entity: T & { id: ID }): Promise<void>;
  remove(id: ID): Promise<void>;
}

/** Lo que lanza un adaptador cuando el backend no está disponible. */
export class BackendUnavailableError extends Error {
  public readonly backend: string;
  public readonly operation: string;

  constructor(backend: string, operation: string) {
    super(`El backend "${backend}" no está disponible para ${operation}.`);
    this.name = 'BackendUnavailableError';
    this.backend = backend;
    this.operation = operation;
  }
}

/** Reloj del sistema: el único `ClockPort` que toca `Date`. */
export const SystemClock: ClockPort = {
  nowIso: (): string => new Date().toISOString(),
  nowMs: (): number => Date.now(),
};

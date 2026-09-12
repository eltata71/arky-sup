/**
 * `services/ports` — los contratos que el dominio necesita del mundo exterior.
 *
 * F3.1. Ningún fichero de este módulo importa React, Firebase, Supabase ni
 * ningún SDK: son interfaces TypeScript puras más errores tipados. Eso es lo
 * que permite probar el dominio sin montar un árbol de React ni arrancar un
 * emulador, que es la salida declarada de F3.
 *
 * Cada puerto tiene su adaptador:
 *  - identidad → `services/adapters/firebaseIdentityAdapter.ts` (Firebase hoy,
 *    Supabase en F4 detrás del mismo puerto).
 *  - reloj → `SystemClock` aquí mismo (no necesita adaptador).
 *  - archivos → repositorios de contexto en F6 (Storage hoy es Firebase,
 *    destino Supabase Storage).
 *  - repositorio → un adaptador por contexto sobre `services/persistence`.
 *
 * La selección Firebase/Supabase por contexto vive en
 * `services/adapters/backendSelection.ts`, no aquí: un puerto describe *qué*
 * necesita el dominio, nunca *cuál* backend lo sirve.
 */

/** Lo mínimo que el dominio necesita saber de quién llama. */
export interface IdentityPort {
  /** UID actual o `null` sin sesión. Nunca lanza. */
  currentUserId(): string | null;
  /** Suscribe cambios de sesión; devuelve la baja. Nunca lanza. */
  observeUserId(listener: (userId: string | null) => void): () => void;
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

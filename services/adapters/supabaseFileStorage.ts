/**
 * `FileStoragePort` servido por Supabase Storage.
 *
 * Los dos cubos son privados y las políticas exigen que la ruta *demuestre* de
 * quién es el objeto. El formato lo fija `private.storage_path_is_well_formed`
 * y no es decorativo:
 *
 *     {uid}/{contexto}/{agregado}/{entidad}/v{versión}/{objectId}.{ext}
 *
 * El primer segmento es el uid de quien sube, así que una ruta ajena falla en la
 * política antes de tocar ningún byte; los cuatro siguientes son la metadata, de
 * modo que un registro que dijera otra cosa no puede coincidir con el fichero;
 * y el último es el **id que Storage asigna**, que es lo que ata la fila de
 * `api.file_objects` al binario concreto.
 *
 * Ese último segmento obliga a una coreografía de tres pasos que conviene
 * entender antes de «simplificarla»:
 *
 *   1. **Subir** a una ruta provisional dentro de la carpeta correcta. Hasta
 *      aquí no se conoce el id: lo acuña Storage al crear la fila.
 *   2. **Mover** el objeto a su nombre definitivo, `{id}.{ext}`. `move`
 *      conserva la fila —y con ella el id—, así que renombrar no rompe el
 *      vínculo.
 *   3. **Registrar** la metadata con `api.register_file_object`, que vuelve a
 *      comprobar ruta, propietario, cubo, MIME, tamaño y checksum contra el
 *      objeto real, y deja el registro en `pending` hasta que
 *      `api.mark_file_object_ready` lo confirma.
 *
 * El estado `pending` es la mitad que hace el diseño honesto: un binario subido
 * cuyo registro no llegó a `ready` **no se puede leer** (`can_read_storage_object`
 * lo rechaza), así que un fallo a medio camino deja un objeto inaccesible en vez
 * de un documento que existe para el almacenamiento y no para el producto.
 */
import { BackendUnavailableError, type FileStoragePort, type StoredFile } from '../ports';

/** Los dos cubos que existen. No hay un tercero al que caer. */
export type StorageContext = 'artifact' | 'initiative';

export const BUCKET_FOR: Record<StorageContext, string> = {
  artifact: 'artifact-files',
  initiative: 'initiative-documents',
};

export interface StorageObjectDescriptor {
  context: StorageContext;
  /** El proyecto o la iniciativa a la que pertenece el archivo. */
  aggregateId: string;
  /** El artefacto o el documento concreto. */
  entityId: string;
  /** Versión del artefacto/documento; empieza en 1. */
  version: number;
}

/** Superficie mínima del cliente de Storage. El SDK no cruza esta frontera. */
export interface SupabaseStorageClientLike {
  storage: {
    from(bucket: string): {
      upload(path: string, body: Blob | ArrayBuffer | Uint8Array, options?: { contentType?: string; upsert?: boolean }):
        Promise<{ data: { id?: string; path?: string } | null; error: unknown }>;
      move(from: string, to: string): Promise<{ data: unknown; error: unknown }>;
      download(path: string): Promise<{ data: Blob | null; error: unknown }>;
      remove(paths: string[]): Promise<{ data: unknown; error: unknown }>;
      createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl?: string } | null; error: unknown }>;
    };
  };
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

const EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'text/csv': 'csv',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'text/yaml': 'yaml',
};

export const extensionFor = (mimeType: string): string => EXTENSIONS[mimeType.toLowerCase()] ?? 'bin';

/** SHA-256 en hexadecimal, con la API del navegador. El servidor lo revalida. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** La carpeta de un archivo, sin su nombre. */
export const folderFor = (ownerId: string, descriptor: StorageObjectDescriptor): string =>
  `${ownerId}/${descriptor.context}/${descriptor.aggregateId}/${descriptor.entityId}/v${descriptor.version}`;

const unwrap = <T>(envelope: { data: T | null; error: unknown }, operation: string): NonNullable<T> => {
  if (envelope.error) throw envelope.error;
  if (envelope.data === null || envelope.data === undefined) {
    throw new Error(`Storage no devolvió datos para ${operation}.`);
  }
  return envelope.data as NonNullable<T>;
};

export interface SupabaseFileStorage extends FileStoragePort {
  /**
   * Sube, registra y confirma un archivo. Devuelve su ruta definitiva.
   *
   * Es la operación que el producto usa; `upload` del puerto queda para el
   * dominio, que no conoce ni el contexto ni la versión.
   */
  put(
    ownerId: string,
    descriptor: StorageObjectDescriptor,
    bytes: Uint8Array,
    mimeType: string,
  ): Promise<{ path: string; objectId: string; sha256: string }>;
  /** Una URL temporal para descargar. No se guarda: caduca. */
  signedUrl(bucket: string, path: string, expiresInSeconds?: number): Promise<string>;
}

export function createSupabaseFileStorage(client: SupabaseStorageClientLike): SupabaseFileStorage {
  const bucketApi = (bucket: string) => client.storage.from(bucket);

  return {
    async upload(bucket, path, bytes, mimeType): Promise<StoredFile> {
      const body = new Blob([bytes as unknown as BlobPart], { type: mimeType });
      const { error } = await bucketApi(bucket).upload(path, body, { contentType: mimeType, upsert: false });
      if (error) throw error;
      return { bucket, path, bytes, mimeType };
    },

    async download(bucket, path): Promise<Uint8Array> {
      const blob = unwrap(await bucketApi(bucket).download(path), `download(${path})`);
      return new Uint8Array(await blob.arrayBuffer());
    },

    async remove(bucket, path): Promise<void> {
      const { error } = await bucketApi(bucket).remove([path]);
      if (error) throw error;
    },

    async put(ownerId, descriptor, bytes, mimeType) {
      const bucket = BUCKET_FOR[descriptor.context];
      const folder = folderFor(ownerId, descriptor);
      const extension = extensionFor(mimeType);
      // Nombre provisional: aún no se conoce el id que Storage asignará, y la
      // política sólo mira la carpeta y el propietario para escribir.
      const staging = `${folder}/upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
      const body = new Blob([bytes as unknown as BlobPart], { type: mimeType });
      const uploaded = unwrap(
        await bucketApi(bucket).upload(staging, body, { contentType: mimeType, upsert: false }),
        'upload',
      );
      const objectId = uploaded.id;
      if (typeof objectId !== 'string' || objectId === '') {
        // Sin id no hay forma de nombrar el objeto como la política exige, y
        // dejarlo en la ruta provisional sería un binario que nadie puede leer
        // ni encontrar. Se retira antes de fallar.
        await bucketApi(bucket).remove([staging]);
        throw new Error('Storage no devolvió el identificador del objeto subido.');
      }

      const finalPath = `${folder}/${objectId}.${extension}`;
      const moved = await bucketApi(bucket).move(staging, finalPath);
      if (moved.error) {
        await bucketApi(bucket).remove([staging]);
        throw moved.error;
      }

      const sha256 = await sha256Hex(bytes);
      try {
        const registered = unwrap(await client.rpc('register_file_object', {
          p_bucket_id: bucket,
          p_object_path: finalPath,
          p_object_id: objectId,
          p_context: descriptor.context,
          p_aggregate_id: descriptor.aggregateId,
          p_entity_id: descriptor.entityId,
          p_version: descriptor.version,
          p_mime_type: mimeType,
          p_size_bytes: bytes.byteLength,
          p_sha256: sha256,
        }), 'register_file_object') as { id?: string };
        if (typeof registered.id !== 'string') throw new Error('El registro del archivo no devolvió identidad.');
        const ready = await client.rpc('mark_file_object_ready', { p_file_id: registered.id });
        if (ready.error) throw ready.error;
      } catch (error) {
        // El binario queda sin registro `ready`, así que es ilegible por
        // política; retirarlo además evita pagar por un objeto que nadie podrá
        // volver a encontrar.
        await bucketApi(bucket).remove([finalPath]);
        throw error;
      }

      return { path: finalPath, objectId, sha256 };
    },

    async signedUrl(bucket, path, expiresInSeconds = 300) {
      const data = unwrap(await bucketApi(bucket).createSignedUrl(path, expiresInSeconds), 'createSignedUrl');
      const url = data.signedUrl;
      if (typeof url !== 'string' || url === '') throw new Error('Storage no devolvió una URL firmada.');
      return url;
    },
  };
}

let cached: SupabaseFileStorage | null = null;

/** Solo para pruebas. */
export const resetFileStorageCache = (): void => { cached = null; };

/** El almacenamiento de archivos del despliegue, cargado en diferido. */
export async function loadFileStorage(
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): Promise<SupabaseFileStorage> {
  if (cached) return cached;
  const { loadSupabaseDataClient } = await import('./supabaseDataBackend');
  const client = await loadSupabaseDataClient(env);
  if (!client) throw new BackendUnavailableError('supabase', 'storage');
  cached = createSupabaseFileStorage(client as unknown as SupabaseStorageClientLike);
  return cached;
}

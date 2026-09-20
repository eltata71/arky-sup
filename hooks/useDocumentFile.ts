/**
 * Subir y abrir el archivo de un documento de iniciativa.
 *
 * Vive en un hook y no en el panel por la razón de siempre —el panel pinta— y
 * por una concreta: la coreografía de Storage tiene tres pasos (subir, renombrar
 * al id que asigna el servidor, registrar y confirmar) y un fallo a medio camino
 * tiene que retirar el binario. Eso no es lógica de una pantalla.
 *
 * Dos decisiones que conviene no deshacer:
 *
 *  - **Se guarda la ruta, nunca una URL.** Los cubos son privados y lo único
 *    que abre un objeto es una URL firmada, que caduca en minutos. Persistir
 *    una sería guardar un enlace roto o, si no caducara, una puerta pública a
 *    un objeto privado escrita en la base de datos.
 *  - **La URL se pide en el momento de abrir**, y se abre en una pestaña nueva
 *    sin `opener`. Una URL firmada es una credencial de un solo objeto: no se
 *    cachea, no se comparte y no se guarda.
 */
import { useCallback, useState } from 'react';
import {
  BUCKET_FOR,
  loadFileStorage,
  type StorageObjectDescriptor,
} from '../services/adapters';
import type { InitiativeDocumentFile } from '../services/businessInitiatives';

/** Lo que el producto acepta. Es un subconjunto de lo que el cubo permite. */
export const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;

export interface DocumentFileUpload {
  /** `null` mientras no hay nada en curso. */
  readonly busy: boolean;
  readonly error: string | null;
  upload(file: File, descriptor: Omit<StorageObjectDescriptor, 'context'>): Promise<InitiativeDocumentFile | null>;
  open(file: InitiativeDocumentFile): Promise<void>;
  clearError(): void;
}

const describe = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/mime|tipo/i.test(message)) return 'Ese tipo de archivo no está permitido.';
  if (/tamaño|size/i.test(message)) return 'El archivo supera el tamaño permitido.';
  if (/sesión|42501|permiso/i.test(message)) return 'Tu sesión no tiene permiso para adjuntar archivos aquí.';
  return 'No se pudo subir el archivo. Inténtalo de nuevo.';
};

export const useDocumentFile = (ownerId: string | null | undefined): DocumentFileUpload => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(async (
    file: File,
    descriptor: Omit<StorageObjectDescriptor, 'context'>,
  ): Promise<InitiativeDocumentFile | null> => {
    if (!ownerId) {
      setError('Necesitas una sesión activa para adjuntar archivos.');
      return null;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      // Se comprueba aquí *además* de en el servidor: decirlo antes de subir
      // 60 MB es la diferencia entre un aviso y un minuto perdido.
      setError('El archivo supera los 50 MB permitidos.');
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const storage = await loadFileStorage();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const mimeType = file.type || 'application/octet-stream';
      const stored = await storage.put(ownerId, { ...descriptor, context: 'initiative' }, bytes, mimeType);
      return {
        bucket: BUCKET_FOR.initiative,
        path: stored.path,
        objectId: stored.objectId,
        mimeType,
        sizeBytes: bytes.byteLength,
        sha256: stored.sha256,
      };
    } catch (cause) {
      setError(describe(cause));
      return null;
    } finally {
      setBusy(false);
    }
  }, [ownerId]);

  const open = useCallback(async (file: InitiativeDocumentFile): Promise<void> => {
    setError(null);
    try {
      const storage = await loadFileStorage();
      const url = await storage.signedUrl(file.bucket, file.path);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setError('No se pudo abrir el archivo. Puede que ya no exista o que tu sesión haya caducado.');
    }
  }, []);

  return { busy, error, upload, open, clearError: () => setError(null) };
};

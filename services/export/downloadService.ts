import type { ExportedFile } from './exportTypes';
import { sanitizeFileName } from './fileNameSanitizer';

export interface DownloadResult {
  filename: string;
  size: number;
  objectUrl?: string;
}

export async function downloadFile(file: ExportedFile): Promise<DownloadResult> {
  if (file.blob.size <= 0) throw new Error('No se descargó el archivo porque el Blob generado está vacío.');
  const filename = sanitizeFileName(file.filename, { extension: file.extension });
  if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) {
    return { filename, size: file.blob.size };
  }
  const url = URL.createObjectURL(file.blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return { filename, size: file.blob.size, objectUrl: url };
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

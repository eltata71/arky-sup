import { useCallback } from 'react';
import type { Artifact, Settings } from '../../types';
import type { DiagramPreflightReport } from '../../services/diagram';
import type {
  ArtifactView,
  ExportFormat,
} from '../../services/export';
import { performArtifactExport } from '../../services/artifacts/exportFacade';

export interface UseArtifactExportInput {
  artifact: Artifact;
  activeView: ArtifactView;
  settings?: Settings;
  modelId?: string;
  diagramPreflight: DiagramPreflightReport | null;
  /** Called when validation blocks the export or the adapter throws. */
  onError?: (message: string, error?: unknown) => void;
  /** Called when the file has been downloaded successfully. */
  onSuccess?: (info: { filename: string; size: number; format: ExportFormat }) => void;
  /** Image exports (png/svg) are delegated to this fast path. */
  onCaptureImage?: (format: 'png' | 'svg') => Promise<void> | void;
}

export interface UseArtifactExportResult {
  exportFormat: (format: ExportFormat) => Promise<void>;
}

/**
 * Hook that wraps the export facade with the same error/toast surface the
 * canvas used to inline. Image exports stay on a fast path so callers can
 * keep using `html-to-image` for live ReactFlow captures.
 */
export const useArtifactExport = (input: UseArtifactExportInput): UseArtifactExportResult => {
  const {
    artifact,
    activeView,
    settings,
    modelId,
    diagramPreflight,
    onError,
    onSuccess,
    onCaptureImage,
  } = input;

  const exportFormat = useCallback(async (format: ExportFormat) => {
    if ((format === 'png' || format === 'svg') && onCaptureImage) {
      try {
        await onCaptureImage(format);
      } catch (err) {
        onError?.('La exportación falló inesperadamente. Revisa la consola para más detalles.', err);
      }
      return;
    }

    try {
      const output = await performArtifactExport({
        artifact,
        activeView,
        format,
        settings,
        modelId,
        diagramPreflight,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        download: true,
      });
      if (output.download) {
        onSuccess?.({ ...output.download, format });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'La exportación falló inesperadamente.';
      onError?.(message, err);
    }
  }, [artifact, activeView, settings, modelId, diagramPreflight, onCaptureImage, onError, onSuccess]);

  return { exportFormat };
};

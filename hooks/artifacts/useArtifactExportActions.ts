import { useCallback, useState, type RefObject } from 'react';
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { ArtifactPresentationModel, PublicationExportMode } from '../../lib/artifacts/artifactPresentationModel';
import type { DiagramPreflightReport } from '../../services/diagram';
import { type ArtifactView, type ExportFormat, validateArtifactForExport } from '../../services/export';
import { exportArtifact } from '../../services/export/exportService';
import { downloadFile } from '../../services/export/downloadService';
import type { ReactFlowCanvasHandle } from '../../components/ReactFlowCanvas';
import type { ArtifactExportOptions } from '../../components/artifacts/export/ArtifactExportModal';

type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface UseArtifactExportActionsInput {
  artifact: Artifact;
  activeView: ArtifactView;
  settings: Settings;
  preflightReport: DiagramPreflightReport | null;
  reactFlowRef: RefObject<ReactFlowCanvasHandle | null>;
  addToast: (message: string, tone?: ToastTone) => void;
  presentationModel?: ArtifactPresentationModel | null;
  exportAsPublication?: boolean;
  publicationMode?: PublicationExportMode;
}

export interface UseArtifactExportActionsResult {
  /** Export the artifact in `format`; routes image formats to the fast path. */
  exportFormat: (format: ExportFormat, options?: ArtifactExportOptions) => Promise<void>;
  /** Convenience wrapper that exports the artifact as Markdown. */
  exportMarkdown: () => Promise<void>;
  /** Copy the raw artifact content to the clipboard. */
  copyMarkdown: () => Promise<void>;
  /** True for ~2s after a successful clipboard copy. */
  markdownCopied: boolean;
}

/**
 * Owns every export / clipboard action for the artifact canvas: image
 * capture (PNG/SVG), document/data exports, and Markdown copy. Validation
 * and preflight gating are preserved exactly from the legacy canvas.
 */
export const useArtifactExportActions = (
  input: UseArtifactExportActionsInput,
): UseArtifactExportActionsResult => {
  const { artifact, activeView, settings, preflightReport, reactFlowRef, addToast, presentationModel, exportAsPublication, publicationMode } = input;
  const [markdownCopied, setMarkdownCopied] = useState(false);

  const captureImage = useCallback(async (
    format: 'png' | 'svg',
    imageOptions?: {
      view?: 'useful' | 'current' | 'executive' | 'technical' | 'full';
      scale?: 1 | 2 | 3;
      frame?: boolean;
      legend?: boolean;
    },
  ) => {
    // Gap 2: formal exports respect the preflight gate (overlap, crop
    // risk, skeleton/placeholder, healthcare gates). The `current` view
    // is still allowed because the user explicitly asked for a snapshot
    // of what they see; it never produces a "formal" artefact.
    const isFormalExport = !imageOptions || imageOptions.view !== 'current';
    if (isFormalExport && preflightReport && !preflightReport.ready) {
      const failed = preflightReport.checks.find((c) => c.status === 'fail');
      console.warn('[useArtifactExportActions] Export blocked by preflight checks.', preflightReport.checks);
      addToast(
        failed
          ? `Exportación bloqueada: ${failed.label.toLowerCase()} — ${failed.detail}`
          : 'Exportación bloqueada: el diagrama no está listo para presentación.',
        'error',
      );
      return;
    }
    if (!reactFlowRef.current) {
      addToast('No hay un canvas activo para exportar. Cambia a la vista de diagrama y reintenta.', 'warning');
      return;
    }
    try {
      const dataUrl = await reactFlowRef.current.exportImage(format, {
        view: imageOptions?.view,
        scale: imageOptions?.scale,
        frame: imageOptions?.frame,
        legend: imageOptions?.legend,
      });
      if (!dataUrl) {
        addToast('No se pudo capturar la imagen. Verifica que el diagrama esté visible y reintenta.', 'error');
        return;
      }
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${artifact.name}.${format}`;
      a.click();
      addToast(`Imagen ${format.toUpperCase()} descargada: ${artifact.name}.${format}`, 'success');
    } catch (err) {
      console.error('[useArtifactExportActions] Image export failed', err);
      addToast('La exportación falló inesperadamente. Revisa la consola para más detalles.', 'error');
    }
  }, [artifact.name, preflightReport, reactFlowRef, addToast]);

  const exportFormat = useCallback(async (format: ExportFormat, options?: ArtifactExportOptions) => {
    const selectedPresentationModel = options?.presentationModel ?? presentationModel ?? null;
    const selectedPublication = Boolean(options?.exportAsPublication ?? exportAsPublication);
    const selectedMode = options?.publicationMode ?? publicationMode;
    const validation = validateArtifactForExport({ artifact, activeView, format, diagramPreflight: preflightReport, presentationModel: selectedPresentationModel, exportAsPublication: selectedPublication, publicationMode: selectedMode });
    if (!validation.canExport) {
      addToast(validation.suggestedAction ? `${validation.message} ${validation.suggestedAction}` : validation.message, 'error');
      return;
    }
    if (format === 'png' || format === 'svg') {
      await captureImage(format, {
        view: options?.imageExportView,
        scale: options?.imageExportScale,
        frame: options?.imageExportFrame,
        legend: options?.imageExportLegend,
      });
      return;
    }
    try {
      const result = await exportArtifact({
        artifact,
        activeView,
        appName: 'Arky 10',
        settings,
        modelId: artifact.generationTrace?.modelEffective?.id ?? artifact.generationTrace?.model ?? settings.aiConfig?.model,
        diagramPreflight: preflightReport,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        includeQualityReport: options?.includeQualityReport,
        qualityOverride: options?.qualityOverride,
        presentationModel: selectedPresentationModel,
        exportAsPublication: selectedPublication,
        publicationMode: selectedMode,
      }, format);
      const download = await downloadFile(result.file);
      addToast(`Archivo descargado: ${download.filename} (${Math.round(download.size / 1024)} KB)`, 'success');
    } catch (err) {
      console.error('[useArtifactExportActions] export failed', err);
      addToast(err instanceof Error ? err.message : 'La exportación falló inesperadamente.', 'error');
    }
  }, [artifact, activeView, settings, preflightReport, captureImage, addToast, presentationModel, exportAsPublication, publicationMode]);

  const exportMarkdown = useCallback(async () => {
    await exportFormat('md');
  }, [exportFormat]);

  const copyMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(artifact.content);
      setMarkdownCopied(true);
      window.setTimeout(() => setMarkdownCopied(false), 2000);
    } catch (e) {
      console.error('No se pudo copiar al portapapeles', e);
      addToast('No se pudo copiar al portapapeles. Selecciona el texto manualmente.', 'error');
    }
  }, [artifact.content, addToast]);

  return { exportFormat, exportMarkdown, copyMarkdown, markdownCopied };
};

import { useCallback, useState, type RefObject } from 'react';
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { ArtifactPresentationModel, PublicationExportMode } from '../../lib/artifacts/artifactPresentationModel';
import { buildAccessibleSummary, toDiagramIR, type DiagramPreflightReport } from '../../services/diagram';
import { type ArtifactView, type DiagramSnapshot, type ExportFormat, snapshotFromFlow, validateArtifactForExport } from '../../services/export';
import { exportArtifact } from '../../services/export/exportService';
import { downloadFile } from '../../services/export/downloadService';
import type { ReactFlowCanvasHandle } from '../../components/ReactFlowCanvas';
import type { ArtifactExportOptions } from '../../components/artifacts/export/ArtifactExportModal';
// Por el fichero: es una puerta declarada y pura; el barrel de publicación arrastra el pipeline entero.
import { resolveDiagramExportBranding } from '../../services/publicationPipeline/diagramExportBranding';
import type { PublicationPackage } from '../../services/publicationPipeline';

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
  /** Los paquetes del proyecto: de ahí sale la marca del marco (plan de diagramas, 2.3). */
  publicationPackages?: readonly PublicationPackage[];
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
  const { artifact, activeView, settings, preflightReport, reactFlowRef, addToast, presentationModel, exportAsPublication, publicationMode, publicationPackages } = input;
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
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const branding = resolveDiagramExportBranding(publicationPackages, artifact, { isDark });
    try {
      const dataUrl = await reactFlowRef.current.exportImage(format, {
        view: imageOptions?.view,
        scale: imageOptions?.scale,
        frame: imageOptions?.frame,
        legend: imageOptions?.legend,
        ...(branding ? {
          branding: { owner: branding.organizationName, confidentiality: branding.confidentiality, accentColor: branding.accentColor },
        } : {}),
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
      // El aviso sólo tiene sentido si se pintó el marco (apagado por defecto en la vista `current`).
      const framed = imageOptions?.frame ?? imageOptions?.view !== 'current';
      if (branding?.issue && framed) addToast(branding.issue, 'warning');
    } catch (err) {
      console.error('[useArtifactExportActions] Image export failed', err);
      addToast('La exportación falló inesperadamente. Revisa la consola para más detalles.', 'error');
    }
  }, [artifact, preflightReport, reactFlowRef, addToast, publicationPackages]);

  /**
   * El PDF de un diagrama se dibuja en vectores a partir del lienzo (plan de
   * diagramas, 2.4): la disposición que ve la persona, su resumen accesible
   * —leído de lo que se ve, así que respeta la audiencia— y la marca de 2.3.
   * Sólo desde la vista Diagrama; en Documento o Híbrido el PDF es el de siempre.
   */
  const diagramSnapshotFor = useCallback((format: ExportFormat): DiagramSnapshot | null => {
    if (format !== 'pdf' || activeView !== 'diagram' || !reactFlowRef.current) return null;
    try {
      const flow = reactFlowRef.current.getFlowData();
      const summary = buildAccessibleSummary(toDiagramIR(flow.nodes, flow.edges)).fullText
        .split(/\n+/).map((line) => line.trim()).filter(Boolean);
      const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
      const branding = resolveDiagramExportBranding(publicationPackages, artifact, { isDark });
      const snapshot = snapshotFromFlow(flow.nodes, flow.edges, summary);
      return snapshot && branding
        ? { ...snapshot, owner: branding.organizationName, confidentiality: branding.confidentiality }
        : snapshot;
    } catch (err) {
      // Sin instantánea, el PDF sale como documento: lo de antes, no un error.
      console.warn('[useArtifactExportActions] no se pudo tomar la instantánea del diagrama', err);
      return null;
    }
  }, [activeView, artifact, publicationPackages, reactFlowRef]);

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
        diagramSnapshot: diagramSnapshotFor(format),
      }, format);
      const download = await downloadFile(result.file);
      addToast(`Archivo descargado: ${download.filename} (${Math.round(download.size / 1024)} KB)`, 'success');
    } catch (err) {
      console.error('[useArtifactExportActions] export failed', err);
      addToast(err instanceof Error ? err.message : 'La exportación falló inesperadamente.', 'error');
    }
  }, [artifact, activeView, settings, preflightReport, captureImage, addToast, presentationModel, exportAsPublication, publicationMode, diagramSnapshotFor]);

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

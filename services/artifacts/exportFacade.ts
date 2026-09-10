/**
 * Single entry point for artifact exports.
 *
 * Wraps `services/export/exportService.ts` + `services/export/downloadService.ts`
 * so callers (UI components and hooks) only deal with the canonical
 * {@link ExportRequest} / {@link ExportResult} contracts.
 */
import type { ExportRequest, ExportResult } from '../../lib/artifacts/contracts';
import { exportArtifact } from '../export/exportService';
import { downloadFile } from '../export/downloadService';
import { validateArtifactForExport } from '../export';
import type { DiagramPreflightReport } from '../diagram/quality/diagramQualityService';
import type { Settings } from '../../types';

export interface PerformExportInput extends ExportRequest {
  appName?: string;
  settings?: Settings;
  modelId?: string;
  diagramPreflight?: DiagramPreflightReport | null;
  userAgent?: string;
  /** When true, also kicks off a `downloadFile` after the export completes. */
  download?: boolean;
}

export interface PerformExportOutput {
  result: ExportResult;
  download?: { filename: string; size: number };
}

/**
 * Validate → export → optionally download. Throws when validation blocks
 * the export so the caller can surface the toast / dialog.
 */
export const performArtifactExport = async (input: PerformExportInput): Promise<PerformExportOutput> => {
  const validation = validateArtifactForExport({
    artifact: input.artifact,
    activeView: input.activeView,
    format: input.format,
    diagramPreflight: input.diagramPreflight ?? null,
  });
  if (!validation.canExport) {
    const message = validation.suggestedAction
      ? `${validation.message} ${validation.suggestedAction}`
      : validation.message;
    throw new Error(message);
  }

  const result = await exportArtifact({
    artifact: input.artifact,
    activeView: input.activeView,
    appName: input.appName ?? 'Arky 10',
    settings: input.settings,
    modelId: input.modelId,
    diagramPreflight: input.diagramPreflight ?? null,
    userAgent: input.userAgent,
  }, input.format);

  const output: PerformExportOutput = {
    result: {
      file: result.file,
      trace: result.trace,
      operationId: result.trace?.id,
    },
  };

  if (input.download) {
    const download = await downloadFile(result.file);
    output.download = { filename: download.filename, size: download.size };
  }

  return output;
};

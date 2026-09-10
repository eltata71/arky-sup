import type { ExportAdapter, ExportContext, ExportFormat, ExportQualityTrace, ExportServiceResult } from './exportTypes';
import { ExportError } from './exportTypes';
import { validateExportRequest, validateExportedBlob } from './exportValidation';
import { startExportTrace, completeExportTrace } from './exportTrace';
import {
  buildArtifactExportabilityState,
  evaluateExportQualityGate,
} from '../quality/artifactQualityGateService';
import { markdownExporter } from './adapters/markdownExporter';
import { htmlExporter } from './adapters/htmlExporter';
import { txtExporter } from './adapters/txtExporter';
import { csvExporter } from './adapters/csvExporter';
import { jsonExporter } from './adapters/jsonExporter';
import { docxExporter } from './adapters/docxExporter';
import { pdfExporter } from './adapters/pdfExporter';
import { xlsxExporter } from './adapters/xlsxExporter';
import { mermaidExporter, diagramJsonExporter } from './adapters/diagramExporter';
import { pptxExporter } from './adapters/pptxExporter';

const adapters: Partial<Record<ExportFormat, ExportAdapter>> = {
  md: markdownExporter,
  html: htmlExporter,
  txt: txtExporter,
  csv: csvExporter,
  json: jsonExporter,
  docx: docxExporter,
  pdf: pdfExporter,
  xlsx: xlsxExporter,
  mermaid: mermaidExporter,
  'diagram-json': diagramJsonExporter,
  pptx: pptxExporter,
};

/** Build the quality traceability payload recorded on every export attempt. */
const buildExportQualityTrace = (context: ExportContext, format: ExportFormat): ExportQualityTrace => {
  const { report } = buildArtifactExportabilityState(context.artifact, { activeView: context.activeView });
  const gate = evaluateExportQualityGate(report, format, context.activeView);
  return {
    score: report.score.value,
    tier: report.score.tier,
    gateId: gate.gateId,
    risk: gate.risk,
    gatePassed: gate.passed,
    override: Boolean(context.qualityOverride),
    blockers: gate.blockers.slice(0, 5).map((b) => b.message),
    warnings: gate.warnings.slice(0, 5).map((w) => w.message),
  };
};

export async function exportArtifact(context: ExportContext, format: ExportFormat): Promise<ExportServiceResult> {
  const validation = validateExportRequest(context, format);
  const trace = startExportTrace(context, format, validation);
  let quality: ExportQualityTrace | undefined;
  try {
    quality = buildExportQualityTrace(context, format);
  } catch (error) {
    console.warn('[export] No se pudo construir la traza de calidad', error);
  }
  try {
    console.info(context.exportAsPublication ? '[presentation.export.requested] publication' : '[presentation.export.requested] original', { format, mode: context.publicationMode, score: context.presentationModel?.quality.score });
    if (!validation.canExport) {
      console.warn('[presentation.export.blocked]', validation);
      throw new ExportError(validation.message, validation.suggestedAction);
    }
    const adapter = adapters[format];
    if (!adapter) throw new ExportError('Formato no disponible.', `No existe adapter para ${format}.`);
    const file = await adapter.export(context);
    await validateExportedBlob(format, file.blob);
    console.info(context.exportAsPublication ? '[presentation.export.publication]' : '[presentation.export.original]', { format, size: file.blob.size });
    const completed = completeExportTrace(trace, { success: true, blobSize: file.blob.size, mimeType: file.mimeType, filename: file.filename, technicalDetails: file.technicalDetails, quality, publication: file.publication ?? trace.publication });
    console.info('[presentation.export.completed]', completed);
    return { file, trace: completed };
  } catch (error) {
    const message = error instanceof ExportError ? error.userMessage : error instanceof Error ? error.message : 'Error desconocido exportando el artefacto.';
    const details = error instanceof ExportError ? error.technicalDetails : error instanceof Error ? error.stack : String(error);
    console.error('[presentation.export.failed]', { format, message, details });
    completeExportTrace(trace, { success: false, errorMessage: message, technicalDetails: details, quality, publication: trace.publication });
    throw new ExportError(message, details, error);
  }
}

export { getExportCapabilities } from './exportRegistry';
export { validateExportRequest } from './exportValidation';
export type { ExportFormat, ArtifactView, ExportCapability } from './exportTypes';

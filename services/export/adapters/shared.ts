import { marked } from 'marked';
import type { Artifact } from '../../../lib/artifacts';
import type { ExportContext, ExportedFile } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { sanitizeFileName } from '../fileNameSanitizer';
import { parseMarkdownTables, type MarkdownTable } from '../../../lib/markdownTables';
import { escapeHtml, stripMarkdown } from '../utils/text';
import { classifyArtifact } from '../../../lib/artifacts/artifactClassification';
import { buildArtifactQualityReport } from '../../quality/artifactQualityService';
import { renderQualityReportMarkdown } from '../../quality/qualityReportRenderer';
import {
  extractPresentationTables,
  renderPresentationModelToMarkdown,
  renderPresentationModelToPlainText,
  resolvePublicationExportMode,
} from '../publicationExportRenderer';

/** True only when the user explicitly selected the publication version. */
export const shouldExportPublication = (context: ExportContext): boolean =>
  Boolean(context.exportAsPublication && context.presentationModel);

/** Publication metadata recorded on every exported file (and mirrored in the trace). */
export const buildPublicationFileMeta = (context: ExportContext): ExportedFile['publication'] => {
  const exportedAsPublication = shouldExportPublication(context);
  return {
    exportedAsPublication,
    mode: exportedAsPublication ? resolvePublicationExportMode(context.publicationMode) : 'original',
    score: context.presentationModel?.quality.score,
    blockers: context.presentationModel?.quality.blockers.length ?? 0,
    warnings: context.presentationModel?.quality.warnings.length ?? 0,
  };
};

export const buildFile = (
  context: ExportContext,
  format: keyof typeof EXPORT_DEFINITIONS,
  blob: Blob,
  details?: string,
): ExportedFile => {
  const definition = EXPORT_DEFINITIONS[format];
  return {
    blob,
    filename: sanitizeFileName(context.artifact.name, { extension: definition.extension }),
    mimeType: definition.mimeType,
    extension: definition.extension,
    format,
    technicalDetails: details,
    publication: buildPublicationFileMeta(context),
  };
};

export const artifactTables = (artifact: Artifact): MarkdownTable[] => parseMarkdownTables(artifact.content);

/** Markdown for the publication version, honoring the requested publication mode. */
export const publicationMarkdown = (context: ExportContext): string => {
  if (!context.presentationModel) throw new Error('No hay modelo de presentación para exportar publicación.');
  return renderPresentationModelToMarkdown(context.presentationModel, context.publicationMode);
};

/** Plain text for the publication version, honoring the requested publication mode. */
export const publicationPlainText = (context: ExportContext): string => {
  if (!context.presentationModel) throw new Error('No hay modelo de presentación para exportar publicación.');
  return renderPresentationModelToPlainText(context.presentationModel, context.publicationMode);
};

/**
 * Structured tables for the publication version. CSV/XLSX always consume the
 * `table-only` slice so the tabular export never depends on document content.
 */
export const publicationTables = (context: ExportContext): MarkdownTable[] => {
  if (!context.presentationModel) return [];
  return extractPresentationTables(context.presentationModel, 'table-only').map((table, index) => ({
    title: table.title || `Tabla publicación ${index + 1}`,
    headers: table.headers,
    rows: table.rows,
    startLine: index + 1,
    endLine: index + table.rows.length + 2,
  }));
};

export const buildMetadata = (context: ExportContext): Array<[string, string]> => {
  const artifact = context.artifact;
  const classification = classifyArtifact(artifact);
  const rows: Array<[string, string]> = [
    ['Artefacto', artifact.name],
    ['Tipo detectado', classification.primaryKind],
    ['Fecha de exportación', (context.generatedAt ?? new Date()).toISOString()],
    ['Aplicación', context.appName ?? 'Arky Pro'],
    ['Modelo IA', context.modelId ?? artifact.generationTrace?.modelEffective?.id ?? artifact.generationTrace?.model ?? context.settings?.aiConfig?.model ?? 'No especificado'],
    ['Versión', `v${artifact.version}`],
    ['Identificador', artifact.id],
  ];
  if (shouldExportPublication(context) && context.presentationModel) {
    rows.push(['Origen del entregable', `Versión publicación · modo ${resolvePublicationExportMode(context.publicationMode)}`]);
    rows.push(['Score de presentación', `${context.presentationModel.quality.score}/100`]);
  }
  return rows;
};

/**
 * Branded HTML document for the *original* artifact content. Publication
 * exports use `renderPresentationModelToHtml` so tables/diagrams are rendered
 * exactly once by the canonical publication renderer.
 */
export const buildHtmlDocument = (context: ExportContext): string => {
  const { artifact } = context;
  const tables = artifactTables(artifact);
  const bodyHtml = marked.parse(artifact.content, { async: false }) as string;
  const qualityHtml = context.includeQualityReport
    ? `<section class="quality-report">${marked.parse(renderQualityReportMarkdown(buildArtifactQualityReport(artifact)), { async: false }) as string}</section>`
    : '';
  const metadataRows = buildMetadata(context).map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(artifact.name)}</title>
<style>
:root{color-scheme:light;--ink:#172033;--muted:#667085;--brand:#4f46e5;--line:#d8deea;--soft:#f5f7fb}*{box-sizing:border-box}body{font-family:Inter,Aptos,Calibri,Arial,sans-serif;color:var(--ink);line-height:1.58;margin:0;background:#fff}.page{max-width:1120px;margin:0 auto;padding:48px}h1{font-size:34px;line-height:1.15;margin:0 0 12px;color:#101828}h2{font-size:22px;margin-top:32px;padding-bottom:8px;border-bottom:1px solid var(--line);color:#1f2a44}h3{font-size:17px;margin-top:24px;color:#344054}.eyebrow{letter-spacing:.16em;text-transform:uppercase;color:var(--brand);font-weight:800;font-size:12px}.subtitle{font-size:17px;color:var(--muted)}.table-wrap{overflow-x:auto;max-width:100%;margin:18px 0 28px;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;min-width:720px;font-size:12px;table-layout:auto}th,td{border:1px solid var(--line);padding:9px 11px;vertical-align:top;overflow-wrap:anywhere}th{background:#eef2ff;color:#27346a;font-weight:800}tbody tr:nth-child(even) td{background:#fafbff}.meta{min-width:0;max-width:860px}.meta th{width:220px;text-align:left;background:var(--soft)}code{background:#f2f4f7;border:1px solid #e4e7ec;border-radius:5px;padding:1px 4px}pre{background:#101828;color:#f9fafb;border-radius:12px;padding:16px;overflow:auto;white-space:pre-wrap}blockquote{border-left:4px solid var(--brand);margin-left:0;padding:8px 16px;background:var(--soft);color:#344054}@media print{.page{padding:0}.table-wrap{overflow:visible;border:0}table{font-size:10px;min-width:0;page-break-inside:auto}tr{page-break-inside:avoid;page-break-after:auto}}
</style>
</head>
<body><main class="page"><div class="eyebrow">${escapeHtml(context.appName ?? 'Arky Pro')} · Exportación documental</div><h1>${escapeHtml(artifact.name)}</h1><p class="subtitle">${escapeHtml(artifact.objective || 'Documento arquitectónico generado para revisión ejecutiva y técnica.')}</p><div class="table-wrap"><table class="meta"><tbody>${metadataRows}</tbody></table></div><section class="content">${bodyHtml}</section>${tables.map((table) => `<section><h2>${escapeHtml(table.title)}</h2><div class="table-wrap"><table><thead><tr>${table.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((row) => `<tr>${table.headers.map((_, i) => `<td>${escapeHtml(row[i] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`).join('')}${qualityHtml}</main></body></html>`;
};

export const plainText = (artifact: Artifact): string => stripMarkdown(artifact.content);

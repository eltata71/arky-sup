import type { Artifact, Settings } from '../../types';
import type { ExportFormat } from './artifactExportValidation';
import { exportArtifact } from './exportService';
import { downloadFile } from './downloadService';
import { buildHtmlDocument } from './adapters/shared';
import { parseMarkdownTables, type MarkdownTable } from '../../lib/markdownTables';

export interface DataTable {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface ArtifactExportPayload {
  fileName: string;
  mimeType: string;
  content: string | Blob;
  mode: 'download';
}

export interface ArtifactExportContext {
  appName?: string;
  modelId?: string;
  settings?: Settings;
  generatedAt?: Date;
}

const toDataTable = (table: MarkdownTable): DataTable => ({ title: table.title, headers: table.headers, rows: table.rows });
export const extractTablesFromContent = (content: string): DataTable[] => parseMarkdownTables(content).map(toDataTable);

export const buildProfessionalHtmlDocument = (artifact: Artifact, context: ArtifactExportContext = {}): string => buildHtmlDocument({
  artifact,
  activeView: 'document',
  appName: context.appName,
  modelId: context.modelId,
  settings: context.settings,
  generatedAt: context.generatedAt,
});

export const buildArtifactExportPayload = async (artifact: Artifact, format: ExportFormat, context: ArtifactExportContext = {}): Promise<ArtifactExportPayload> => {
  const result = await exportArtifact({
    artifact,
    activeView: 'document',
    appName: context.appName,
    modelId: context.modelId,
    settings: context.settings,
    generatedAt: context.generatedAt,
  }, format);
  return { fileName: result.file.filename, mimeType: result.file.mimeType, content: result.file.blob, mode: 'download' };
};

export const downloadPayload = async (payload: ArtifactExportPayload): Promise<void> => {
  const blob = payload.content instanceof Blob ? payload.content : new Blob([payload.content], { type: payload.mimeType });
  await downloadFile({ blob, filename: payload.fileName, mimeType: payload.mimeType, extension: payload.fileName.split('.').pop() ?? 'bin', format: 'json' });
};

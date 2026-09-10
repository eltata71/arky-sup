import type { ExportAdapter, ExportContext } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { buildFile, artifactTables, publicationTables, shouldExportPublication } from './shared';

const escapeCsvCell = (cell: string): string => `"${cell.replace(/"/g, '""')}"`;

export function buildCsv(context: ExportContext): string {
  const table = (shouldExportPublication(context) ? publicationTables(context) : artifactTables(context.artifact))[0];
  if (!table) throw new Error('No se detectó tabla Markdown para exportar CSV.');
  return `\ufeff${[table.headers, ...table.rows].map((row) => row.map(escapeCsvCell).join(',')).join('\r\n')}`;
}

export const csvExporter: ExportAdapter = {
  format: 'csv',
  async export(context) {
    const blob = new Blob([buildCsv(context)], { type: EXPORT_DEFINITIONS.csv.mimeType });
    return buildFile(context, 'csv', blob);
  },
};

import type { ExportAdapter } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { buildFile, plainText, publicationPlainText, shouldExportPublication } from './shared';

export const txtExporter: ExportAdapter = {
  format: 'txt',
  async export(context) {
    const content = shouldExportPublication(context) ? publicationPlainText(context) : plainText(context.artifact);
    const blob = new Blob([content], { type: EXPORT_DEFINITIONS.txt.mimeType });
    return buildFile(context, 'txt', blob);
  },
};

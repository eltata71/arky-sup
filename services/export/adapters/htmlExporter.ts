import type { ExportAdapter } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { buildFile, buildHtmlDocument, shouldExportPublication } from './shared';
import { renderPresentationModelToHtml } from '../publicationExportRenderer';

export const htmlExporter: ExportAdapter = {
  format: 'html',
  async export(context) {
    const html = shouldExportPublication(context) && context.presentationModel
      ? renderPresentationModelToHtml(context.presentationModel, context.publicationMode)
      : buildHtmlDocument(context);
    const blob = new Blob([html], { type: EXPORT_DEFINITIONS.html.mimeType });
    return buildFile(context, 'html', blob);
  },
};

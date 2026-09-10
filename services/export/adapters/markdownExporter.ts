import type { ExportAdapter } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { buildFile, publicationMarkdown, shouldExportPublication } from './shared';
import { buildArtifactQualityReport } from '../../quality/artifactQualityService';
import { renderQualityReportMarkdown } from '../../quality/qualityReportRenderer';

export const markdownExporter: ExportAdapter = {
  format: 'md',
  async export(context) {
    let content = shouldExportPublication(context) ? publicationMarkdown(context) : context.artifact.content;
    if (context.includeQualityReport) {
      const report = buildArtifactQualityReport(context.artifact);
      content = `${content.trimEnd()}\n\n---\n\n${renderQualityReportMarkdown(report)}\n`;
    }
    const blob = new Blob([content], { type: EXPORT_DEFINITIONS.md.mimeType });
    return buildFile(context, 'md', blob);
  },
};

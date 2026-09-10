import { classifyArtifact } from '../../../lib/artifacts/artifactClassification';
import type { ExportAdapter } from '../exportTypes';
import { EXPORT_DEFINITIONS } from '../exportRegistry';
import { buildFile, artifactTables, buildMetadata, shouldExportPublication } from './shared';
import { renderPresentationModelToJson } from '../publicationExportRenderer';
import { buildArtifactExportabilityState } from '../../quality/artifactQualityGateService';

export const jsonExporter: ExportAdapter = {
  format: 'json',
  async export(context) {
    const { report, state } = buildArtifactExportabilityState(context.artifact, { activeView: context.activeView });
    const payload = shouldExportPublication(context) && context.presentationModel ? renderPresentationModelToJson(context.presentationModel, context.publicationMode) : {
      artifact: context.artifact,
      classification: classifyArtifact(context.artifact),
      metadata: buildMetadata(context),
      tables: artifactTables(context.artifact),
      // The technical JSON export carries the full formal ArtifactQualityReport
      // so downstream auditing tools share the same source of truth.
      quality: {
        score: report.score,
        profile: report.profile.id,
        dimensions: report.dimensions,
        issues: report.issues,
        recommendations: report.recommendations,
        document: report.document,
        diagram: report.diagram,
        tablesSummary: report.tables,
        evaluatedAt: report.evaluatedAt,
        report,
        exportability: state,
      },
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: EXPORT_DEFINITIONS.json.mimeType });
    return buildFile(context, 'json', blob);
  },
};

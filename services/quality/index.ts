/**
 * Public surface of the artifact quality module.
 */

export * from './artifactQualityModel';
export {
  resolveQualityProfile,
  listQualityProfiles,
  QUALITY_PROFILE_FALLBACKS,
} from './qualityProfiles';
export {
  analyzeDocumentQuality,
  type DocumentQualitySnapshot,
} from './documentQualityService';
export {
  analyzeDiagramQualityBridge,
  type DiagramQualitySnapshot,
} from './diagramQualityBridge';
export {
  buildArtifactQualityReport,
  documentDimensions,
  diagramDimensions,
  exportDimensions,
} from './artifactQualityService';
export {
  evaluateArtifactQualityGates,
  gateForFormat,
} from './qualityGate';
export {
  buildArtifactExportabilityState,
  evaluateExportQualityGate,
  canExportWithQualityGate,
  buildQualityGateMessage,
  mapQualityIssuesToExportChecks,
  exportFamilyForFormat,
  evaluateDocumentExportGate,
  evaluateDiagramExportGate,
  evaluateTableExportGate,
  type ExportFamily,
  type ArtifactQualityGateContext,
  type ArtifactExportabilitySnapshot,
  type QualityGateDecision,
} from './artifactQualityGateService';
export {
  repairDocumentContent,
  buildTraceabilityTable,
  type DocumentRepairResult,
  type DocumentRepairChange,
} from './documentAutoRepair';
export {
  renderQualityReportMarkdown,
} from './qualityReportRenderer';

/**
 * Two questions about a document, one module.
 *
 * `assessDocumentArtifact` asks whether a generation is *acceptable* — is it
 * truncated, does it have the sections its contract promises — and the
 * generation retry loop branches on the answer. `analyzeDocumentQuality` asks
 * *how good* it is, per dimension, and the gates and reports render that.
 *
 * They used to be two files called `documentQualityService.ts`, one directory
 * apart, modelling the same subject with different scales and unaware of each
 * other. Opening "the document quality service" was a coin flip. They are now
 * one module and their file names say which question each answers.
 */
export {
  assessDocumentArtifact,
  assessPresentationDeck,
  type DeckAssessment,
  type DocumentAssessment,
  type DocumentQualityIssue,
} from './documentAcceptability';

// Diagram quality is owned by `services/diagram` and reached through its
// barrel. What lives here is `diagramQualityBridge` — this context's view of a
// diagram's score, in the same vocabulary as an artifact's — not a second copy.

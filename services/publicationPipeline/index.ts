/**
 * Professional Publication Pipeline — public barrel.
 *
 * The publication pipeline is the third pillar of Arky's world-class artifact
 * stack. It turns validated, traceable artifacts into professional, accessible,
 * governed and auditable deliverables: it grades readiness, runs a 27-check
 * preflight, validates accessibility, builds packages and profiles, drives a
 * governed approval workflow, versions deliverables, generates manifests and
 * publication reports, and orchestrates exports through the existing adapters.
 *
 * This module is additive and backwards-compatible: it never mutates legacy
 * types and packages attach to `Project.publicationPackages` as an optional
 * block. Every entry point is total — it never throws.
 */

export * from './PublicationPipelineTypes';

export {
  trackPublicationEvent,
  reportPublicationFailure,
  type PublicationEventName,
} from './PublicationObservability';

export {
  DEFAULT_PUBLICATION_BRANDING,
  resolveDefaultBranding,
  sanitizeBranding,
  buildBrandingFooter,
} from './PublicationBrandingService';

export {
  listPublicationProfiles,
  getPublicationProfile,
  resolvePublicationProfile,
  getProfileByAudience,
  listPublicationTemplates,
  getPublicationTemplate,
  resolvePublicationTemplate,
} from './PublicationTemplateRegistry';

export {
  validatePublicationPackage,
  validatePublicationPackages,
  type PublicationValidationIssue,
  type PublicationValidationResult,
} from './PublicationRuntimeValidation';

export {
  resolveArtifactCompilation,
  isPublishGradeTier,
  summarizeArtifactQuality,
  buildQualityResult,
  computeGraphCoverage,
  buildTraceabilityResult,
} from './PublicationQualityBridge';

export {
  evaluatePublicationAccessibility,
} from './PublicationAccessibilityService';

export {
  runArtifactPreflight,
  runPackagePreflight,
  runSingleArtifactPreflight,
  type PackagePreflightInput,
} from './PublicationPreflightService';

export {
  buildAuditEntry,
  appendAuditEntry,
  appendAuditEntries,
  countOverrides,
  lastAuditEntry,
  type AuditEntryInput,
} from './PublicationAuditTrailService';

export {
  buildArtifactRef,
  computeVersionDiff,
  refreshPackageFreshness,
  createPackageVersion,
  isPublishedPackageOutdated,
} from './PublicationVersionService';

export {
  submitForReview,
  requestChanges,
  approvePackage,
  publishPackage,
  archivePackage,
  reopenPackage,
  type PublicationTransitionResult,
  type PublishOptions,
} from './PublicationApprovalService';

export {
  computeCoverage,
  evaluatePackageReadiness,
  buildPublicationReport,
  type ReadinessInput,
} from './PublicationReadinessService';

export {
  generatePublicationManifest,
  assertManifestIsSafe,
  type GenerateManifestInput,
} from './PublicationManifestService';

export {
  orderArtifactRefsEditorially,
  suggestPackageArtifacts,
  createPublicationPackage,
  updatePackageArtifacts,
  updatePackageMetadata,
} from './PublicationPackageService';

export {
  renderManifestMarkdown,
  buildExecutiveSummaryMarkdown,
  buildQualityEvidenceMarkdown,
  buildTraceabilityEvidenceMarkdown,
  exportPublicationArtifact,
  exportPublicationDocument,
  runPublicationExportBatch,
  buildDefaultExportJobs,
  type PublicationExportBatchInput,
} from './PublicationExportOrchestrator';

export {
  PUBLICATION_PACKAGES_PROJECT_FIELD,
  getPublicationSubcollectionPath,
  serializePublicationPackages,
  deserializePublicationPackages,
  readPublicationPackages,
  attachPublicationPackages,
  upsertPublicationPackage,
  removePublicationPackage,
  buildPublicationUpdatePayload,
} from './PublicationPersistenceAdapter';

export {
  resolvePackageArtifacts,
  resolvePackageProfile,
  createPackageForProject,
  runProjectPackagePreflight,
  evaluateProjectPackage,
  generateProjectPackageManifest,
  publishProjectPackage,
  refreshProjectPackages,
  versionProjectPackage,
  isKnownPublicationProfile,
  type PublishPackageResult,
} from './PublicationPipelineService';

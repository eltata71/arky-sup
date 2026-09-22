/**
 * Professional Publication Pipeline — canonical type system.
 *
 * The publication pipeline is the third pillar of Arky's world-class artifact
 * stack. It sits *above* artifact generation, the Artifact Compiler and the
 * Architecture Knowledge Graph and turns validated, traceable artifacts into
 * professional, accessible, governed and auditable deliverables.
 *
 * Design rules (every shape in this file honours them):
 *  - Additive & backwards-compatible: nothing here mutates legacy types. The
 *    persisted block attaches to `Project.publicationPackages` as an optional
 *    array; legacy projects simply have `undefined`.
 *  - Plain JSON only: no `Date`, no `Map`, no class instances — so packages are
 *    trivially serializable for Firestore / localStorage.
 *  - Total & safe: services built on these types never throw; they degrade.
 *
 * The pipeline never replaces the export adapters, the compiler or the graph —
 * it orchestrates them.
 */

import type { ArtifactType } from '../../types';
import type { ExportFormat } from '../export/exportTypes';

/* ------------------------------------------------------------------------- */
/* Schema versioning                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Bump when the persisted shape of {@link PublicationPackage} changes in a
 * non-backwards-compatible way. Runtime validation tolerates older versions.
 */
export const PUBLICATION_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------------- */
/* Audiences & purposes                                                       */
/* ------------------------------------------------------------------------- */

/** Who a deliverable is built for. Drives template + tone selection. */
export type PublicationAudience =
  | 'executive'
  | 'technical'
  | 'operations'
  | 'vendor'
  | 'audit'
  | 'architecture-board'
  | 'implementation-team';

/** Why a deliverable exists. Drives required-section selection. */
export type PublicationPurpose =
  | 'decision-making'
  | 'architecture-review'
  | 'vendor-evaluation'
  | 'implementation-handoff'
  | 'audit-evidence'
  | 'technical-design'
  | 'executive-briefing'
  | 'project-documentation';

/** Editorial detail level requested for a rendered deliverable. */
export type PublicationDetailLevel = 'summary' | 'standard' | 'detailed';

/** Minimum accessibility bar a package must clear before it can publish. */
export type PublicationAccessibilityLevel = 'basic' | 'standard' | 'strict';

/* ------------------------------------------------------------------------- */
/* Severity & verdict ladders                                                 */
/* ------------------------------------------------------------------------- */

export type PublicationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * Quality / readiness tier. Mirrors the compiler ladder so the whole stack
 * speaks one language.
 *  - world-class           90–100
 *  - ready                 80–89
 *  - usable-with-warnings  70–79
 *  - needs-improvement     50–69
 *  - blocked               < 50 or any critical blocker
 */
export type PublicationTier =
  | 'world-class'
  | 'ready'
  | 'usable-with-warnings'
  | 'needs-improvement'
  | 'blocked';

/** Coarse verdict shared by preflight, readiness and accessibility reports. */
export type PublicationVerdict = 'passed' | 'warning' | 'blocked';

/* ------------------------------------------------------------------------- */
/* Publication profiles                                                       */
/* ------------------------------------------------------------------------- */

/** A required or optional editorial section inside a profile. */
export interface PublicationProfileSection {
  /** Stable slug, e.g. `executive-summary`. */
  id: string;
  /** Human label (Spanish-first). */
  title: string;
  /** Short description of what the section must contain. */
  description: string;
  /** When false the section is recommended but not blocking. */
  required: boolean;
}

/**
 * A flexible artifact-coverage requirement. Where `requiredArtifactTypes` is a
 * flat list (kept for the canonical contract), this models "any one of these
 * N types satisfies the slot" — e.g. a context *or* container diagram.
 */
export interface PublicationArtifactRequirement {
  id: string;
  label: string;
  /** Any artifact whose type is in this list satisfies the requirement. */
  anyOf: ArtifactType[];
  /** Minimum number of matching artifacts. */
  min: number;
  /** When false the requirement is recommended, not blocking. */
  required: boolean;
}

/**
 * A publication profile: the contract for one class of deliverable. Profiles
 * are pure data — the registry resolves them and the readiness service grades
 * packages against them.
 */
export interface PublicationProfile {
  id: string;
  name: string;
  description: string;
  audience: PublicationAudience;
  purpose: PublicationPurpose;
  /** Ordered editorial sections expected in the deliverable. */
  requiredSections: PublicationProfileSection[];
  /** Flat list of artifact types that MUST be present. */
  requiredArtifactTypes: ArtifactType[];
  /** Flat list of artifact types that enrich but do not block. */
  optionalArtifactTypes: ArtifactType[];
  /** Rich, "any-of" coverage requirements (superset of the flat lists). */
  artifactRequirements: PublicationArtifactRequirement[];
  /** Minimum compiler/quality score (0–100) every artifact should clear. */
  qualityThreshold: number;
  accessibilityLevel: PublicationAccessibilityLevel;
  /** Export formats this profile is designed to produce. */
  exportFormats: ExportFormat[];
  approvalRequired: boolean;
  brandingRequired: boolean;
  traceabilityRequired: boolean;
  appendicesRequired: boolean;
}

/* ------------------------------------------------------------------------- */
/* Editorial templates                                                        */
/* ------------------------------------------------------------------------- */

export type PublicationTemplateBlockKind =
  | 'cover'
  | 'table-of-contents'
  | 'executive-summary'
  | 'version-control'
  | 'approval-control'
  | 'section'
  | 'optional-section'
  | 'appendix'
  | 'glossary'
  | 'traceability-matrix'
  | 'publication-notes'
  | 'metadata'
  | 'branding'
  | 'footer';

/** One ordered block inside an editorial template. */
export interface PublicationTemplateBlock {
  id: string;
  kind: PublicationTemplateBlockKind;
  title: string;
  /** When false the block is rendered only when content exists. */
  required: boolean;
  /** Optional guidance rendered as helper text in empty blocks. */
  guidance?: string;
}

/**
 * An editorial template. Decoupled from the UI: it only describes ordered
 * blocks. Renderers (export orchestrator, report builder) consume it.
 */
export interface PublicationTemplate {
  id: string;
  name: string;
  description: string;
  audience: PublicationAudience;
  detailLevel: PublicationDetailLevel;
  blocks: PublicationTemplateBlock[];
}

/** Lookup criteria for the template registry. */
export interface PublicationTemplateQuery {
  profileId?: string;
  audience?: PublicationAudience;
  detailLevel?: PublicationDetailLevel;
  exportFormat?: ExportFormat;
}

/* ------------------------------------------------------------------------- */
/* Branding                                                                   */
/* ------------------------------------------------------------------------- */

/** Branding applied to a published deliverable (never holds secrets). */
export interface PublicationBranding {
  organizationName: string;
  productName: string;
  /** Short confidentiality / classification label, e.g. "Confidencial". */
  confidentiality: string;
  /** Accent colour as a hex string (validated). */
  accentColor: string;
  /** Footer line shown on every page. */
  footerText: string;
  /** Optional logo URL — never a data-URI of unbounded size. */
  logoUrl?: string;
}

/* ------------------------------------------------------------------------- */
/* Packages                                                                   */
/* ------------------------------------------------------------------------- */

/** Lifecycle status of a publication package. */
export type PublicationPackageStatus =
  | 'draft'
  | 'ready-for-review'
  | 'changes-requested'
  | 'approved'
  | 'published'
  | 'archived'
  | 'blocked';

/** Why a published package may have drifted out of date. */
export type PublicationFreshness = 'current' | 'stale' | 'outdated';

/** A reference to an artifact frozen into a package version. */
export interface PublicationArtifactRef {
  artifactId: string;
  versionGroupId: string;
  /** Artifact version number captured when the package was last versioned. */
  version: number;
  name: string;
  type: ArtifactType;
  /** Compiler tier snapshot, when available. */
  compilerTier?: string;
  /** Compiler score snapshot, when available. */
  compilerScore?: number;
}

/** Compact quality roll-up persisted on a package. */
export interface PublicationQualitySummary {
  /** Aggregate score 0–100 across included artifacts. */
  score: number;
  tier: PublicationTier;
  /** Per-artifact score map keyed by artifact id. */
  artifactScores: Record<string, number>;
  /** Count of artifacts below the profile quality threshold. */
  belowThresholdCount: number;
}

/** Compact accessibility roll-up persisted on a package. */
export interface PublicationAccessibilitySummary {
  score: number;
  level: PublicationAccessibilityLevel;
  verdict: PublicationVerdict;
  issueCount: number;
}

/** Compact traceability roll-up persisted on a package. */
export interface PublicationTraceabilitySummary {
  /** Requirement coverage 0–1. */
  requirementCoverage: number;
  /** Risk-mitigation coverage 0–1. */
  riskCoverage: number;
  /** Architecture graph coverage 0–1. */
  graphCoverage: number;
  /** Count of open consistency issues feeding the package. */
  consistencyIssueCount: number;
}

/**
 * The persisted publication package. Attaches additively to
 * `Project.publicationPackages`.
 */
export interface PublicationPackage {
  id: string;
  /** Persisted schema version — see {@link PUBLICATION_SCHEMA_VERSION}. */
  schemaVersion: number;
  projectId: string;
  name: string;
  description: string;
  profileId: string;
  /** Artifact references included in the package, in editorial order. */
  artifactRefs: PublicationArtifactRef[];
  status: PublicationPackageStatus;
  /** Monotonic package version, starts at 1. */
  version: number;
  freshness: PublicationFreshness;
  createdAt: string;
  updatedAt: string;
  createdBy?: PublicationActor;
  approvedBy?: PublicationActor;
  approvedAt?: string;
  publishedAt?: string;
  /** Optional branding override; falls back to the profile/default. */
  branding?: PublicationBranding;
  quality?: PublicationQualitySummary;
  accessibility?: PublicationAccessibilitySummary;
  traceability?: PublicationTraceabilitySummary;
  /** The manifest of the last successful publication, when published. */
  manifest?: PublicationManifest;
  /** Append-only governance + lifecycle audit trail. */
  auditTrail: PublicationAuditEntry[];
}

/* ------------------------------------------------------------------------- */
/* Actors                                                                     */
/* ------------------------------------------------------------------------- */

/** A user acting on a package. `system` is used when no session is available. */
export interface PublicationActor {
  id: string;
  name: string;
  role?: string;
}

/* ------------------------------------------------------------------------- */
/* Audit trail                                                                */
/* ------------------------------------------------------------------------- */

export type PublicationAuditAction =
  | 'package-created'
  | 'package-updated'
  | 'artifacts-changed'
  | 'preflight-run'
  | 'readiness-evaluated'
  | 'accessibility-checked'
  | 'submitted-for-review'
  | 'changes-requested'
  | 'approved'
  | 'published'
  | 'archived'
  | 'version-created'
  | 'manifest-generated'
  | 'exported'
  | 'marked-outdated'
  | 'override-used';

/** A single append-only governance event. */
export interface PublicationAuditEntry {
  id: string;
  packageId: string;
  /** Optional artifact this entry concerns. */
  artifactId?: string;
  action: PublicationAuditAction;
  actor: PublicationActor;
  timestamp: string;
  /** Short, user-facing description (Spanish-first). */
  details: string;
  /** Optional before/after snapshot for status transitions. */
  before?: string;
  after?: string;
}

/* ------------------------------------------------------------------------- */
/* Preflight                                                                  */
/* ------------------------------------------------------------------------- */

/** Stable codes for the 27 preflight checks (Task 4). */
export type PublicationPreflightCode =
  | 'artifact-empty'
  | 'artifact-corrupt'
  | 'artifact-compilation-failed'
  | 'artifact-low-score'
  | 'artifact-critical-issues'
  | 'diagram-skeleton-fallback'
  | 'diagram-orphan-nodes'
  | 'diagram-insufficient-relations'
  | 'document-missing-objective'
  | 'document-missing-scope'
  | 'document-missing-risks'
  | 'document-missing-decisions'
  | 'sdd-missing-required-sections'
  | 'matrix-empty-or-missing-cells'
  | 'dictionary-missing-fields'
  | 'traceability-insufficient'
  | 'graph-inconsistency'
  | 'graph-stale'
  | 'requirement-without-coverage'
  | 'risk-without-mitigation'
  | 'decision-without-impact'
  | 'artifact-missing-version'
  | 'artifact-missing-review-status'
  | 'artifact-pending-approval'
  | 'exporter-unavailable'
  | 'format-incompatible-with-view'
  | 'accessibility-issue'
  | 'editorial-structure-issue'
  | 'profile-requirement-unmet';

/** A single preflight finding. */
export interface PublicationPreflightFinding {
  id: string;
  code: PublicationPreflightCode;
  severity: PublicationSeverity;
  /** When true the finding blocks publication. */
  blocking: boolean;
  /** Artifact this finding concerns, when artifact-scoped. */
  artifactId?: string;
  artifactName?: string;
  message: string;
  recommendation: string;
}

/** A required or optional remediation step surfaced to the user. */
export interface PublicationAction {
  id: string;
  title: string;
  detail: string;
  priority: PublicationSeverity;
  artifactId?: string;
}

/** Per-artifact preflight outcome. */
export interface PublicationArtifactPreflight {
  artifactId: string;
  artifactName: string;
  artifactType: ArtifactType;
  verdict: PublicationVerdict;
  score: number;
  findings: PublicationPreflightFinding[];
}

/** Result of running preflight over an artifact or a whole package. */
export interface PublicationPreflightReport {
  /** Stable id for trace correlation. */
  id: string;
  scope: 'artifact' | 'package';
  /** Package id when scope is `package`; artifact id when scope is `artifact`. */
  targetId: string;
  generatedAt: string;
  verdict: PublicationVerdict;
  passed: boolean;
  blocked: boolean;
  /** Aggregate readiness score 0–100. */
  score: number;
  findings: PublicationPreflightFinding[];
  /** Findings narrowed to non-blocking warnings. */
  warnings: PublicationPreflightFinding[];
  requiredActions: PublicationAction[];
  optionalActions: PublicationAction[];
  artifactResults: PublicationArtifactPreflight[];
  canPublish: boolean;
  canExport: boolean;
  requiresApproval: boolean;
  requiresHumanReview: boolean;
}

/* ------------------------------------------------------------------------- */
/* Accessibility                                                              */
/* ------------------------------------------------------------------------- */

export type PublicationAccessibilityCode =
  | 'heading-hierarchy'
  | 'diagram-alt-text'
  | 'contrast'
  | 'table-headers'
  | 'color-only-severity'
  | 'label-legibility'
  | 'title-length'
  | 'navigable-structure'
  | 'error-message-clarity'
  | 'dark-mode-compatible'
  | 'visible-focus'
  | 'button-aria-label'
  | 'loading-error-states'
  | 'export-metadata'
  | 'readable-in-export';

export interface PublicationAccessibilityIssue {
  id: string;
  code: PublicationAccessibilityCode;
  severity: PublicationSeverity;
  blocking: boolean;
  artifactId?: string;
  artifactName?: string;
  message: string;
  recommendation: string;
}

export interface PublicationAccessibilityReport {
  id: string;
  scope: 'artifact' | 'package';
  targetId: string;
  generatedAt: string;
  level: PublicationAccessibilityLevel;
  verdict: PublicationVerdict;
  /** Accessibility score 0–100. */
  score: number;
  issues: PublicationAccessibilityIssue[];
  recommendations: PublicationAction[];
  /** True when the minimum accessibility bar is not met. */
  blocked: boolean;
}

/* ------------------------------------------------------------------------- */
/* Readiness report                                                           */
/* ------------------------------------------------------------------------- */

/** Coverage outcome for one profile artifact requirement. */
export interface PublicationCoverageResult {
  requirementId: string;
  label: string;
  required: boolean;
  satisfied: boolean;
  /** Matching artifact ids found in the package. */
  matchedArtifactIds: string[];
  message: string;
}

/** Quality grading slice of the readiness report. */
export interface PublicationQualityResult {
  score: number;
  tier: PublicationTier;
  belowThresholdArtifacts: string[];
  message: string;
}

/** Traceability grading slice of the readiness report. */
export interface PublicationTraceabilityResult {
  requirementCoverage: number;
  riskCoverage: number;
  graphCoverage: number;
  uncoveredRequirementNames: string[];
  risksWithoutMitigationNames: string[];
  decisionsWithoutImpactNames: string[];
  consistencyIssueCount: number;
  verdict: PublicationVerdict;
  message: string;
}

/** Export grading slice of the readiness report. */
export interface PublicationExportResult {
  /** Formats that can be produced for the whole package. */
  availableFormats: ExportFormat[];
  /** Formats requested by the profile that are not available. */
  missingFormats: ExportFormat[];
  verdict: PublicationVerdict;
  message: string;
}

/** Approval grading slice of the readiness report. */
export interface PublicationApprovalResult {
  required: boolean;
  satisfied: boolean;
  status: PublicationPackageStatus;
  message: string;
}

/**
 * The top-level package readiness report. Composes preflight, accessibility,
 * traceability, quality, export and approval results into one verdict.
 */
export interface PublicationReadinessReport {
  id: string;
  packageId: string;
  profileId: string;
  generatedAt: string;
  status: PublicationVerdict;
  /** Aggregate readiness score 0–100. */
  score: number;
  tier: PublicationTier;
  blockers: PublicationPreflightFinding[];
  warnings: PublicationPreflightFinding[];
  recommendations: PublicationAction[];
  artifactResults: PublicationArtifactPreflight[];
  coverageResults: PublicationCoverageResult[];
  accessibilityResults: PublicationAccessibilityReport;
  traceabilityResults: PublicationTraceabilityResult;
  qualityResults: PublicationQualityResult;
  exportResults: PublicationExportResult;
  approvalResults: PublicationApprovalResult;
  /** True when the package can move to `published`. */
  canPublish: boolean;
  /** True when at least one export family is allowed. */
  canExport: boolean;
}

/* ------------------------------------------------------------------------- */
/* Manifest                                                                   */
/* ------------------------------------------------------------------------- */

/** One artifact entry inside a manifest. */
export interface PublicationManifestArtifact {
  artifactId: string;
  name: string;
  type: ArtifactType;
  version: number;
  qualityScore?: number;
  qualityTier?: string;
  reviewStatus?: string;
}

/** One exported-file entry inside a manifest. */
export interface PublicationManifestFile {
  artifactId?: string;
  label: string;
  format: ExportFormat;
  filename: string;
  /** Size in bytes, when known. */
  size?: number;
  exportedAt: string;
}

/**
 * The publication manifest: a tamper-evident, auditable record of exactly what
 * a published package contained. Never holds secrets.
 */
export interface PublicationManifest {
  packageId: string;
  packageVersion: number;
  projectId: string;
  projectName: string;
  profileId: string;
  profileName: string;
  audience: PublicationAudience;
  purpose: PublicationPurpose;
  generatedAt: string;
  generatedBy?: PublicationActor;
  artifacts: PublicationManifestArtifact[];
  qualityScore: number;
  qualityTier: PublicationTier;
  accessibilityScore: number;
  traceabilityCoverage: number;
  architectureGraphCoverage: number;
  exportedFiles: PublicationManifestFile[];
  approval: {
    required: boolean;
    status: PublicationPackageStatus;
    approvedBy?: PublicationActor;
    approvedAt?: string;
  };
  audit: {
    entryCount: number;
    lastAction?: PublicationAuditAction;
    lastActionAt?: string;
    overridesUsed: number;
  };
}

/* ------------------------------------------------------------------------- */
/* Publication report                                                         */
/* ------------------------------------------------------------------------- */

/** The human-facing publication report (Task 12), renderable to MD/HTML/etc. */
export interface PublicationReport {
  id: string;
  packageId: string;
  generatedAt: string;
  /** Markdown body, ready to hand to the export adapters. */
  markdown: string;
  /** Plain-text one-paragraph summary, for "copy summary" UX. */
  summary: string;
}

/* ------------------------------------------------------------------------- */
/* Versioning                                                                 */
/* ------------------------------------------------------------------------- */

/** Outcome of comparing a package against the project's current artifacts. */
export interface PublicationVersionDiff {
  freshness: PublicationFreshness;
  /** Artifact ids whose version advanced since the package was versioned. */
  changedArtifactIds: string[];
  /** Artifact ids referenced by the package but missing from the project. */
  removedArtifactIds: string[];
  message: string;
}

/* ------------------------------------------------------------------------- */
/* Export orchestration                                                       */
/* ------------------------------------------------------------------------- */

/** What kind of publication artefact an export job produces. */
export type PublicationExportKind =
  | 'artifact'
  | 'manifest'
  | 'report'
  | 'executive-summary'
  | 'quality-evidence'
  | 'traceability-evidence';

export interface PublicationExportJob {
  kind: PublicationExportKind;
  format: ExportFormat;
  /** Required when `kind` is `artifact`. */
  artifactId?: string;
}

export interface PublicationExportOutcome {
  job: PublicationExportJob;
  success: boolean;
  filename?: string;
  size?: number;
  /** User-facing error message when `success` is false. */
  error?: string;
}

export interface PublicationExportBatchResult {
  packageId: string;
  generatedAt: string;
  outcomes: PublicationExportOutcome[];
  manifestFiles: PublicationManifestFile[];
  /** True when every job succeeded. */
  allSucceeded: boolean;
}

/* ------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Flat, decoupled project projection consumed by the pipeline. The integration
 * layer maps a `Project` into this shape so core services never depend on the
 * app's mutable domain model.
 */
export interface PublicationProjectInput {
  projectId: string;
  projectName: string;
  artifacts: import('../../lib/artifacts').Artifact[];
  architectureKnowledgeGraph?: import('../architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes').ArchitectureGraph;
  /**
   * Freshness of the persisted graph relative to the project's current
   * artifacts. Lets the pipeline warn when a traceability-required profile
   * would publish against an out-of-date graph. Optional and
   * backwards-compatible — absent freshness simply skips the staleness check.
   */
  architectureKnowledgeGraphFreshness?: import('../architectureKnowledgeGraph/ArchitectureGraphFreshness').ArchitectureGraphFreshness;
}

/** Options accepted when creating a package. */
export interface CreatePublicationPackageInput {
  projectId: string;
  name: string;
  description?: string;
  profileId: string;
  artifactIds?: string[];
  branding?: PublicationBranding;
  actor?: PublicationActor;
}

/* ------------------------------------------------------------------------- */
/* Shared pure helpers                                                         */
/* ------------------------------------------------------------------------- */

/** Clamp a number into [0, 100] and round it. Tolerates NaN/Infinity. */
export const clampPublicationScore = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
};

/** Map a 0–100 score to the canonical publication tier. */
export const publicationTierFromScore = (score: number): PublicationTier => {
  const clamped = clampPublicationScore(score);
  if (clamped >= 90) return 'world-class';
  if (clamped >= 80) return 'ready';
  if (clamped >= 70) return 'usable-with-warnings';
  if (clamped >= 50) return 'needs-improvement';
  return 'blocked';
};

/** Friendly Spanish label for a publication tier. */
export const publicationTierLabel = (tier: PublicationTier): string => {
  switch (tier) {
    case 'world-class': return 'Clase mundial';
    case 'ready': return 'Listo';
    case 'usable-with-warnings': return 'Usable con avisos';
    case 'needs-improvement': return 'Requiere mejoras';
    case 'blocked': return 'Bloqueado';
  }
};

/** Friendly Spanish label for a package status. */
export const publicationStatusLabel = (status: PublicationPackageStatus): string => {
  switch (status) {
    case 'draft': return 'Borrador';
    case 'ready-for-review': return 'Listo para revisión';
    case 'changes-requested': return 'Cambios solicitados';
    case 'approved': return 'Aprobado';
    case 'published': return 'Publicado';
    case 'archived': return 'Archivado';
    case 'blocked': return 'Bloqueado';
  }
};

/** The single actor used when no authenticated session is available. */
export const SYSTEM_PUBLICATION_ACTOR: PublicationActor = {
  id: 'system',
  name: 'Sistema',
  role: 'system',
};

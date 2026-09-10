/**
 * Formal model for Artifact Quality.
 *
 * This module defines the canonical types used by the quality pipeline:
 *
 *   ArtifactQualityProfile     → expected dimensions + thresholds per type
 *   ArtifactQualityDimension   → a single scored axis (label + score 0–100)
 *   ArtifactQualityScore       → aggregated weighted score (0–100) + tier
 *   ArtifactQualityIssue       → a single finding (severity + recommendation)
 *   ArtifactQualityRecommendation → human-facing follow-up action
 *   ArtifactQualityGateResult  → contextual gate outcome (per format/view)
 *   ArtifactQualityReport      → top-level snapshot consumed by UI + export
 *
 * The model is intentionally provider-agnostic: documents, diagrams, tables
 * and hybrid artifacts all use the same shapes so the UI can render a single
 * panel and the export pipeline can gate uniformly.
 */

import type { ArtifactType } from '../../types';
import type { ExportFormat } from '../../lib/artifacts/exportContracts';

export type ArtifactQualitySeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export type ArtifactQualityTier = 'world-class' | 'professional' | 'acceptable' | 'risky' | 'blocked';

export type ArtifactQualityScope =
  | 'document'
  | 'diagram'
  | 'table'
  | 'matrix'
  | 'traceability'
  | 'hybrid'
  | 'export';

/** A single evaluated quality dimension (e.g. "estructura de encabezados"). */
export interface ArtifactQualityDimension {
  id: string;
  /** Human-facing label (Spanish-first; the UI does not surface raw ids). */
  label: string;
  scope: ArtifactQualityScope;
  /** Weight inside the parent profile. Sum across a profile should be ~100. */
  weight: number;
  /** Score in [0, 100]. */
  score: number;
  /** Optional rationale shown in the panel tooltip. */
  detail?: string;
}

export interface ArtifactQualityScore {
  /** Overall weighted score in [0, 100]. */
  value: number;
  /** Discrete tier derived from `value` and severity caps. */
  tier: ArtifactQualityTier;
  /** Friendly one-liner describing the tier. */
  summary: string;
}

export interface ArtifactQualityIssue {
  id: string;
  code: string;
  severity: ArtifactQualitySeverity;
  scope: ArtifactQualityScope;
  /** Short, user-facing message (no jargon). */
  message: string;
  /** Concrete, actionable next step. */
  recommendation: string;
  /** Optional dimension this issue penalises. */
  dimensionId?: string;
  /** Whether the system can auto-fix this issue without user choice. */
  autoFixable?: boolean;
}

export interface ArtifactQualityRecommendation {
  id: string;
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
  /** Maps to a known auto-repair action id, when present. */
  actionId?: string;
}

/**
 * Result of evaluating an artifact against a contextual quality gate
 * (typically tied to an export format or interactive use case).
 */
export interface ArtifactQualityGateResult {
  /** Logical name of the gate (e.g. "export:pdf"). */
  gateId: string;
  /** Whether the gate allows the operation to proceed. */
  passed: boolean;
  /**
   * Risk level the user is taking on if they proceed despite a warning.
   *  - `none`   → green path
   *  - `low`    → minor cosmetic issues
   *  - `medium` → quality below recommended; allow with explicit consent
   *  - `high`   → output likely to be embarrassing or partially broken
   *  - `critical` → output would be empty/corrupt; do not allow
   */
  risk: 'none' | 'low' | 'medium' | 'high' | 'critical';
  /** Whether the gate may be overridden by the user (e.g. "export anyway"). */
  allowOverride: boolean;
  /** Short, user-facing summary of the outcome. */
  message: string;
  /** Ordered list of blocking findings (top contributor first). */
  blockers: ArtifactQualityIssue[];
  /** Ordered list of warnings that don't block but should be surfaced. */
  warnings: ArtifactQualityIssue[];
}

export interface ArtifactQualityProfileThresholds {
  /** Min overall score for "world class". */
  worldClass: number;
  /** Min overall score for "professional". */
  professional: number;
  /** Min overall score for "acceptable". */
  acceptable: number;
  /** Min overall score to allow export without explicit override. */
  exportFloor: number;
}

export interface ArtifactQualityProfile {
  id: string;
  /** Human label shown in the panel. */
  label: string;
  /** Which artifact types this profile applies to. */
  appliesTo: readonly ArtifactType[];
  /** Logical "family" the profile belongs to (used by routing). */
  family:
    | 'document-executive'
    | 'document-technical'
    | 'document-srs'
    | 'document-brd'
    | 'document-sdd'
    | 'document-glossary'
    | 'document-bdd'
    | 'matrix'
    | 'data-dictionary'
    | 'diagram-c4'
    | 'diagram-process'
    | 'diagram-data-flow'
    | 'diagram-integration'
    | 'diagram-erd'
    | 'diagram-sequence'
    | 'hybrid';
  dimensions: readonly Omit<ArtifactQualityDimension, 'score' | 'detail'>[];
  thresholds: ArtifactQualityProfileThresholds;
}

/** Snapshot of the artifact's quality at a point in time. */
export interface ArtifactQualityReport {
  /** Stable id (UUID-like) for trace correlation. */
  id: string;
  artifactId: string;
  artifactType: ArtifactType;
  profile: ArtifactQualityProfile;
  score: ArtifactQualityScore;
  /** Per-dimension breakdown sorted by weight descending. */
  dimensions: ArtifactQualityDimension[];
  /** Findings sorted by severity then by dimension. */
  issues: ArtifactQualityIssue[];
  /** Actionable next steps (1..N items). */
  recommendations: ArtifactQualityRecommendation[];
  /** Snapshot of the embedded diagram quality, when applicable. */
  diagram?: {
    score: number;
    summary: string;
    issueCount: number;
  };
  /** Snapshot of the document layer when applicable. */
  document?: {
    score: number;
    /** Word count for rough size signal. */
    wordCount: number;
    /** Whether headings, objective, scope, etc. were detected. */
    hasStructure: boolean;
  };
  /** Snapshot of any tables embedded in the artifact. */
  tables?: {
    count: number;
    /** Approx. completeness across all tables (0..1). */
    completeness: number;
  };
  evaluatedAt: string;
}

export interface ArtifactQualityExportabilityState {
  /** Whether a *document* export (DOCX/PDF/HTML/MD/TXT/JSON) can proceed. */
  document: ArtifactQualityGateResult;
  /** Whether a *diagram* export (PNG/SVG/Mermaid/diagram-json) can proceed. */
  diagram: ArtifactQualityGateResult;
  /** Whether a *table* export (CSV/XLSX) can proceed. */
  table: ArtifactQualityGateResult;
}

export const isBlockingSeverity = (severity: ArtifactQualitySeverity): boolean =>
  severity === 'critical';

export const tierFromScore = (score: number, thresholds: ArtifactQualityProfileThresholds): ArtifactQualityTier => {
  if (score >= thresholds.worldClass) return 'world-class';
  if (score >= thresholds.professional) return 'professional';
  if (score >= thresholds.acceptable) return 'acceptable';
  if (score >= thresholds.exportFloor) return 'risky';
  return 'blocked';
};

export const tierLabel = (tier: ArtifactQualityTier): string => {
  switch (tier) {
    case 'world-class': return 'Clase mundial';
    case 'professional': return 'Profesional';
    case 'acceptable': return 'Aceptable';
    case 'risky': return 'En riesgo';
    case 'blocked': return 'No listo';
  }
};

export const tierSummary = (tier: ArtifactQualityTier, scope: 'document' | 'diagram' | 'hybrid'): string => {
  const subject = scope === 'document' ? 'documento' : scope === 'diagram' ? 'diagrama' : 'artefacto';
  switch (tier) {
    case 'world-class': return `${subject[0].toUpperCase()}${subject.slice(1)} de clase mundial: listo para comité ejecutivo.`;
    case 'professional': return `${subject[0].toUpperCase()}${subject.slice(1)} profesional: sólido para compartir con stakeholders.`;
    case 'acceptable': return `${subject[0].toUpperCase()}${subject.slice(1)} aceptable: requiere mejoras menores antes de presentar.`;
    case 'risky': return `${subject[0].toUpperCase()}${subject.slice(1)} en riesgo: revisar los hallazgos antes de exportar.`;
    case 'blocked': return `${subject[0].toUpperCase()}${subject.slice(1)} no exportable: requiere correcciones estructurales.`;
  }
};

export type DocumentExportFormat = Extract<ExportFormat, 'pdf' | 'docx' | 'html' | 'md' | 'txt' | 'json'>;
export type DiagramExportFormat = Extract<ExportFormat, 'png' | 'svg' | 'mermaid' | 'diagram-json'>;
export type TableExportFormat = Extract<ExportFormat, 'csv' | 'xlsx'>;

/**
 * Type system for the Artifact Compilation & Review Engine.
 *
 * The compiler is a formal stage that sits between artifact
 * generation/normalization and persistence. It governs validation, safe
 * repair, scoring, traceability and exportability — without replacing the
 * existing diagram pipeline, document quality service or export gate.
 *
 * Every shape here is additive. Nothing in this module mutates legacy types;
 * the persisted summary ({@link ArtifactCompilerSummary}) is attached to
 * `Artifact.compilation` as an optional, backwards-compatible block.
 */

import type { Artifact, ArtifactType } from '../../types';

/** Coarse outcome of a compilation pass. */
export type CompilationStatus =
  | 'passed' // contract satisfied, no repairs needed
  | 'warning' // usable but has non-blocking findings
  | 'repaired' // safe non-destructive repairs were applied
  | 'failed' // the compiler itself failed; artifact returned untouched
  | 'blocked'; // empty/corrupt/critical — must not ship as-is

/**
 * Freshness of a persisted compilation relative to the artifact it describes.
 *  - `current` — computed against the artifact's present compilation surface;
 *  - `stale`   — a compilation-relevant field changed after it was produced;
 *  - `missing` — the artifact carries no compilation at all (legacy artifacts).
 *
 * The persisted summary only ever stores `current` (a snapshot is `current` the
 * instant it is written). The live answer is derived by `getCompilationFreshness`,
 * which re-checks the stored `sourceSignature` against the current artifact.
 */
export type CompilationFreshness = 'current' | 'stale' | 'missing';

/**
 * World-class tier ladder. Fixed thresholds (independent of the per-profile
 * quality thresholds) so the compiler speaks a single, stable language.
 *  - world-class           90–100
 *  - ready                 80–89
 *  - usable-with-warnings  70–79
 *  - needs-improvement     50–69
 *  - blocked               < 50 or any critical issue
 */
export type CompilationTier =
  | 'world-class'
  | 'ready'
  | 'usable-with-warnings'
  | 'needs-improvement'
  | 'blocked';

export type CompilerIssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Where a finding originated, so the UI can route the user to the right fix. */
export type CompilerIssueSource =
  | 'contract' // missing/weak section required by the contract
  | 'structure' // headings, placeholders, malformed lists/tables
  | 'document' // delegated document quality finding
  | 'diagram' // delegated diagram quality-gate finding
  | 'export' // exportability finding
  | 'compiler'; // internal compiler error

export interface CompilerIssue {
  id: string;
  code: string;
  severity: CompilerIssueSeverity;
  source: CompilerIssueSource;
  /** Short, user-facing message (Spanish-first, no jargon). */
  message: string;
  /** Concrete, actionable next step. */
  recommendation: string;
  /** Optional section/dimension this issue penalises. */
  dimension?: string;
  /** Whether a deterministic repair can address it. */
  autoFixable?: boolean;
}

/** Grouped issues, ready for the UI to render per-severity columns. */
export interface CompilerIssueGroups {
  critical: CompilerIssue[];
  high: CompilerIssue[];
  medium: CompilerIssue[];
  low: CompilerIssue[];
  info: CompilerIssue[];
}

export type CompilerRepairKind =
  | 'structure' // added/normalised headings
  | 'normalization' // normalised lists, markers, whitespace
  | 'section' // scaffolded a missing contract section
  | 'cleanup'; // removed evident duplication

export interface CompilerRepair {
  id: string;
  kind: CompilerRepairKind;
  /** Human-facing description of exactly what changed. */
  description: string;
  /** Repairs are always non-destructive — user content is never replaced. */
  destructive: false;
}

export interface CompilerRecommendation {
  id: string;
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
}

/** A single consolidated scoring axis (Task 6). */
export interface CompilerDimensionScore {
  id: string;
  label: string;
  /** Score in [0, 100]. */
  score: number;
  /** Relative weight inside the unified score. */
  weight: number;
}

export interface CompilerScore {
  /** Unified score in [0, 100]. */
  value: number;
  tier: CompilationTier;
  /** Per-dimension breakdown (estructura, completitud, …). */
  dimensions: CompilerDimensionScore[];
  /** One-line, user-facing summary of the tier. */
  summary: string;
}

/** Per-family export readiness, derived from the existing export gate. */
export interface CompilerExportReadiness {
  document: boolean;
  diagram: boolean;
  table: boolean;
  /** At least one family can be exported. */
  any: boolean;
}

export type CompilationStage =
  | 'contract-resolution'
  | 'pre-validation'
  | 'repair'
  | 'post-validation'
  | 'scoring'
  | 'export-evaluation'
  | 'finalize';

export interface CompilationStep {
  stage: CompilationStage;
  status: 'success' | 'warning' | 'error' | 'skipped';
  message: string;
  detail?: string;
  at: string;
  durationMs?: number;
}

/** Full, in-memory compilation trace (not all of it is persisted). */
export interface ArtifactCompilationTrace {
  id: string;
  artifactId: string;
  contractId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: CompilationStatus;
  score: number;
  tier: CompilationTier;
  steps: CompilationStep[];
  repairs: CompilerRepair[];
  warnings: string[];
  errors: string[];
}

/** Structured result returned by {@link compileArtifact}. */
export interface CompiledArtifactResult {
  /** The candidate artifact exactly as received. */
  original: Artifact;
  /**
   * The improved/repaired artifact. Reference-equal to `original` when no
   * repairs were applied, so callers can cheaply detect changes.
   */
  compiled: Artifact;
  contractId: string;
  contractLabel: string;
  status: CompilationStatus;
  score: CompilerScore;
  issues: CompilerIssueGroups;
  repairs: CompilerRepair[];
  recommendations: CompilerRecommendation[];
  /** Whether the compiled artifact has a safe, non-empty view to render. */
  canRender: boolean;
  /** Whether at least one export family is allowed for the compiled artifact. */
  canExport: boolean;
  exportReadiness: CompilerExportReadiness;
  /** True when a human should look before the artifact is shared/exported. */
  requiresHumanReview: boolean;
  trace: ArtifactCompilationTrace;
}

/**
 * Compact, persistable projection of a compilation pass. Attached to
 * `Artifact.compilation` (additive, backwards-compatible — Task 10).
 */
export interface ArtifactCompilerSummary {
  compilerContractId: string;
  compilerContractLabel: string;
  compilerStatus: CompilationStatus;
  compilerScore: number;
  compilerTier: CompilationTier;
  compilerIssues: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  /** Descriptions of repairs applied during compilation. */
  compilerRepairs: string[];
  /** Titles of the top recommendations. */
  compilerRecommendations: string[];
  compiledAt: string;
  requiresHumanReview: boolean;
  exportReadiness: CompilerExportReadiness;
  /**
   * Freshness recorded when this summary was written — always `'current'`. The
   * live freshness is derived from {@link CompilationFreshness} by re-checking
   * `sourceSignature`. Optional so legacy persisted summaries stay valid.
   */
  compilationFreshness?: Exclude<CompilationFreshness, 'missing'>;
  /**
   * Deterministic fingerprint of the compilation-relevant artifact surface
   * (content, type, representation, objective, keyConcepts, ir, envelope) at
   * the time of compilation. Absent on legacy snapshots — those are treated as
   * stale so they are recompiled before being trusted.
   */
  sourceSignature?: string;
}

export interface CompileArtifactOptions {
  /**
   * Apply deterministic, non-destructive repairs (default: true). When false
   * the compiler only reports — `compiled` always equals `original`.
   */
  applyRepairs?: boolean;
  /** Logical origin of the compilation, recorded in the trace. */
  source?: 'generation' | 'persistence' | 'manual' | 'export' | 'unknown';
}

/** Narrow helper type — the contract registry keys off artifact types. */
export type CompilerArtifactType = ArtifactType;

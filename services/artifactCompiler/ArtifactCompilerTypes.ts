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

import type { ArtifactType } from '../../types';
import type { Artifact, CompilationStatus, CompilationTier, CompilerExportReadiness } from '../../lib/artifacts';
// El resumen persistido en `Artifact.compilation` y el vocabulario que usa
// viven en `lib/artifacts` (F3-07): son forma sin comportamiento que el
// Artefacto transporta, y el Artefacto es núcleo compartido.
export type {
  CompilationStatus,
  CompilationFreshness,
  CompilationTier,
  CompilerExportReadiness,
  ArtifactCompilerSummary,
} from '../../lib/artifacts';


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

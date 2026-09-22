/**
 * El resumen de compilación que un Artefacto guarda en `compilation`.
 *
 * Es la parte **persistida** del compilador —lo que sobrevive a una recarga—, y
 * por eso viaja con el Artefacto. El compilador, sus perfiles y su
 * comportamiento siguen en `services/artifactCompiler`, que reexporta estas
 * declaraciones. Bajaron aquí con el Artefacto en F3-07: sin ellas, el núcleo
 * compartido habría importado un contexto de dominio.
 */

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

/** Per-family export readiness, derived from the existing export gate. */
export interface CompilerExportReadiness {
  document: boolean;
  diagram: boolean;
  table: boolean;
  /** At least one family can be exported. */
  any: boolean;
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

/**
 * Artifact Compilation & Review Engine — public surface.
 *
 * The compiler governs the generation → validation → repair → scoring →
 * traceability → exportability lifecycle for every artifact family, layered
 * additively on top of the existing diagram pipeline, document quality service
 * and export quality gate.
 *
 * Entry points:
 *  - `compileArtifact`               — full compilation pass (structured result).
 *  - `recompileArtifactBeforePersist`— centralised recompilation for every
 *                                      artifact mutation flow (Task 2).
 *  - `attachCompilerSummary`         — observe-only persistence helper.
 *  - `buildCompilerSummary`          — project a result onto the persistable block.
 *  - `getCompilationFreshness`       — `current` | `stale` | `missing` (Task 5).
 */

import type { Artifact } from '../../types';
import { recompileArtifactBeforePersist } from './recompile';

export { compileArtifact, buildCompilerSummary } from './ArtifactCompiler';
export { resolveContract, getContractById, listContracts } from './ArtifactContractRegistry';
export { CompilationTraceRecorder } from './ArtifactCompilationTrace';
export {
  recompileArtifactBeforePersist,
  type CompilationMode,
  type RecompileOptions,
  type RecompileOutcome,
} from './recompile';
export {
  computeArtifactCompilationSignature,
  getCompilationFreshness,
  isCompilationFresh,
  RECOMPILE_RELEVANT_FIELDS,
} from './artifactSignature';

export type {
  ArtifactContract,
  ContractSection,
  ContractRules,
  ContractThresholds,
  ArtifactRepresentation,
  SectionRequirement,
} from './ArtifactContract';

export type {
  ArtifactCompilationTrace,
  ArtifactCompilerSummary,
  CompilationStage,
  CompilationStatus,
  CompilationStep,
  CompilationTier,
  CompileArtifactOptions,
  CompiledArtifactResult,
  CompilerDimensionScore,
  CompilerExportReadiness,
  CompilerIssue,
  CompilerIssueGroups,
  CompilerIssueSeverity,
  CompilerIssueSource,
  CompilerRecommendation,
  CompilerRepair,
  CompilerRepairKind,
  CompilerScore,
  CompilationFreshness,
} from './ArtifactCompilerTypes';

/**
 * Observe-only persistence integration.
 *
 * Runs the compiler in `safe` mode — WITHOUT applying repairs, so there is no
 * silent content mutation on the persist path — and returns a shallow copy of
 * the artifact carrying a fresh compilation summary on `Artifact.compilation`.
 *
 * Delegates to {@link recompileArtifactBeforePersist}, which never throws and
 * routes compiler failures through observability (so a degraded compilation is
 * never silently attached as if it were healthy). On a hard failure the
 * original artifact is returned untouched, so persistence is never broken.
 */
export const attachCompilerSummary = (artifact: Artifact): Artifact =>
  recompileArtifactBeforePersist(artifact, {
    source: 'persistence',
    mode: 'safe',
    force: true,
  }).artifact;

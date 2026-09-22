/**
 * Quality bridge for the publication pipeline (Tasks 13 & 14).
 *
 * The publication pipeline never re-implements quality, compilation or
 * traceability — it *reads* the existing engines:
 *  - the Artifact Compiler (`services/artifactCompiler`) owns contract
 *    validation, repair, scoring, tiers and export readiness;
 *  - the Architecture Knowledge Graph (`services/architectureKnowledgeGraph`)
 *    owns entities, relations, consistency and traceability.
 *
 * This module folds both into publication-friendly value objects. It reuses a
 * persisted compiler snapshot when one exists and only recomputes when it is
 * absent — so it never does redundant work. Every function is total.
 */

import type { Artifact } from '../../lib/artifacts';
import { compileArtifact, buildCompilerSummary, getCompilationFreshness } from '../artifactCompiler';
import type { ArtifactCompilerSummary } from '../artifactCompiler/ArtifactCompilerTypes';
import {
  analyzeArchitectureConsistency,
  analyzeArchitectureTraceability,
  getEntitiesInArtifact,
  getRequirementsWithoutCoverage,
  getRisksWithoutMitigation,
  getDecisionsWithoutImpact,
} from '../architectureKnowledgeGraph';
import type { ArchitectureGraph } from '../architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';
import {
  clampPublicationScore,
  publicationTierFromScore,
  type PublicationQualityResult,
  type PublicationQualitySummary,
  type PublicationTraceabilityResult,
} from './PublicationPipelineTypes';

/* ------------------------------------------------------------------------- */
/* Compiler bridge (Task 14)                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Resolve the compiler summary for an artifact. Reuses the persisted
 * `artifact.compilation` snapshot only while it is provably *current* — i.e.
 * its signature still matches the artifact's content. A stale or missing
 * snapshot is recomputed (observe-only) so the publication preflight never
 * evaluates readiness against an obsolete compilation (Task 15). Never throws.
 */
export const resolveArtifactCompilation = (artifact: Artifact): ArtifactCompilerSummary => {
  if (artifact.compilation && getCompilationFreshness(artifact) === 'current') {
    return artifact.compilation;
  }
  try {
    const result = compileArtifact(artifact, { source: 'export', applyRepairs: false });
    return buildCompilerSummary(result);
  } catch {
    return {
      compilerContractId: 'unknown',
      compilerContractLabel: 'Contrato desconocido',
      compilerStatus: 'failed',
      compilerScore: 0,
      compilerTier: 'blocked',
      compilerIssues: { critical: 1, high: 0, medium: 0, low: 0, info: 0 },
      compilerRepairs: [],
      compilerRecommendations: [],
      compiledAt: new Date().toISOString(),
      requiresHumanReview: true,
      exportReadiness: { document: false, diagram: false, table: false, any: false },
    };
  }
};

/** True when the compiler tier is publish-grade (`ready` or `world-class`). */
export const isPublishGradeTier = (tier: string): boolean =>
  tier === 'ready' || tier === 'world-class';

/* ------------------------------------------------------------------------- */
/* Package quality roll-up                                                     */
/* ------------------------------------------------------------------------- */

/**
 * Aggregate compiler scores across a set of artifacts into a publication
 * quality summary. An empty set scores 0 (blocked) — empty packages are never
 * publish-grade.
 */
export const summarizeArtifactQuality = (
  artifacts: Artifact[],
  qualityThreshold: number,
): PublicationQualitySummary => {
  const artifactScores: Record<string, number> = {};
  let total = 0;
  let belowThresholdCount = 0;

  for (const artifact of artifacts) {
    const summary = resolveArtifactCompilation(artifact);
    const score = clampPublicationScore(summary.compilerScore);
    artifactScores[artifact.id] = score;
    total += score;
    if (score < qualityThreshold) belowThresholdCount += 1;
  }

  const score = artifacts.length > 0 ? clampPublicationScore(total / artifacts.length) : 0;
  return {
    score,
    tier: publicationTierFromScore(score),
    artifactScores,
    belowThresholdCount,
  };
};

/** Build the readiness-report quality slice from a package quality summary. */
export const buildQualityResult = (
  artifacts: Artifact[],
  summary: PublicationQualitySummary,
  qualityThreshold: number,
): PublicationQualityResult => {
  const belowThresholdArtifacts = artifacts
    .filter((a) => (summary.artifactScores[a.id] ?? 0) < qualityThreshold)
    .map((a) => a.id);
  const message = belowThresholdArtifacts.length === 0
    ? `Todos los artefactos alcanzan el umbral de calidad (${qualityThreshold}).`
    : `${belowThresholdArtifacts.length} artefacto(s) por debajo del umbral de calidad (${qualityThreshold}).`;
  return {
    score: summary.score,
    tier: summary.tier,
    belowThresholdArtifacts,
    message,
  };
};

/* ------------------------------------------------------------------------- */
/* Architecture Knowledge Graph bridge (Task 13)                                */
/* ------------------------------------------------------------------------- */

/**
 * Compute graph coverage for a set of artifacts: the share of artifacts that
 * contributed at least one entity to the canonical model, in [0..1].
 */
export const computeGraphCoverage = (
  graph: ArchitectureGraph | undefined,
  artifactIds: string[],
): number => {
  if (!graph || artifactIds.length === 0) return 0;
  const contributing = artifactIds.filter((id) => getEntitiesInArtifact(graph, id).length > 0);
  return contributing.length / artifactIds.length;
};

/**
 * Build the readiness-report traceability slice from the graph. When no graph
 * exists the slice resolves as a non-blocking warning (graphs are optional on
 * legacy projects).
 */
export const buildTraceabilityResult = (
  graph: ArchitectureGraph | undefined,
  artifactIds: string[],
): PublicationTraceabilityResult => {
  if (!graph) {
    return {
      requirementCoverage: 0,
      riskCoverage: 0,
      graphCoverage: 0,
      uncoveredRequirementNames: [],
      risksWithoutMitigationNames: [],
      decisionsWithoutImpactNames: [],
      consistencyIssueCount: 0,
      verdict: 'warning',
      message: 'No hay grafo de conocimiento de arquitectura; reconstrúyelo para evaluar trazabilidad.',
    };
  }

  const traceability = analyzeArchitectureTraceability(graph);
  const consistency = analyzeArchitectureConsistency(graph);
  const uncoveredRequirements = getRequirementsWithoutCoverage(graph);
  const risksWithoutMitigation = getRisksWithoutMitigation(graph);
  const decisionsWithoutImpact = getDecisionsWithoutImpact(graph);
  const graphCoverage = computeGraphCoverage(graph, artifactIds);

  const criticalConsistency = consistency.issues.filter((i) => i.severity === 'critical').length;
  const verdict: PublicationTraceabilityResult['verdict'] = criticalConsistency > 0
    ? 'blocked'
    : (uncoveredRequirements.length > 0 || risksWithoutMitigation.length > 0)
      ? 'warning'
      : 'passed';

  const message = verdict === 'passed'
    ? 'Trazabilidad y consistencia del grafo en buen estado.'
    : verdict === 'blocked'
      ? `Hay ${criticalConsistency} inconsistencia(s) crítica(s) en el grafo de arquitectura.`
      : 'Hay brechas de cobertura de requerimientos o riesgos sin mitigación.';

  return {
    requirementCoverage: traceability.requirementCoverage,
    riskCoverage: traceability.riskCoverage,
    graphCoverage,
    uncoveredRequirementNames: uncoveredRequirements.slice(0, 12).map((e) => e.name),
    risksWithoutMitigationNames: risksWithoutMitigation.slice(0, 12).map((e) => e.name),
    decisionsWithoutImpactNames: decisionsWithoutImpact.slice(0, 12).map((e) => e.name),
    consistencyIssueCount: consistency.issues.length,
    verdict,
    message,
  };
};

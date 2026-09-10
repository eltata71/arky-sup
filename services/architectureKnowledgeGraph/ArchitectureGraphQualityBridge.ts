/**
 * Quality bridge between the Architecture Knowledge Graph and the Artifact
 * Compilation Engine (Task 11).
 *
 * This module does not duplicate the compiler's responsibilities. The compiler
 * still owns contract validation, repair, scoring and exportability. The
 * bridge only contributes the *graph-derived* signal: which entities /
 * relations an artifact grounds, how well it is integrated into the canonical
 * model, and which consistency issues / traceability gaps reference it.
 *
 * The result ({@link ArchitectureArtifactGraphInsight}) is a plain, additive
 * value object the compiler or the inspector UI can fold in as it sees fit.
 */

import type {
  ArchitectureArtifactGraphInsight,
  ArchitectureGraph,
  ArchitectureGraphArtifactInput,
} from './ArchitectureKnowledgeGraphTypes';
import { analyzeArchitectureConsistency } from './ArchitectureConsistencyService';
import { analyzeArchitectureTraceability } from './ArchitectureTraceabilityService';
import { getEntitiesInArtifact } from './ArchitectureTraceabilityService';

/**
 * Builds the per-artifact graph insight. Pure — never throws. When the
 * artifact contributed nothing to the graph the insight still resolves, with
 * `coverageScore: 0` and `shouldWarn: true`.
 */
export const buildArtifactGraphInsight = (
  graph: ArchitectureGraph,
  artifactId: string,
  artifacts: ArchitectureGraphArtifactInput[] = [],
): ArchitectureArtifactGraphInsight => {
  const ownEntities = getEntitiesInArtifact(graph, artifactId);
  const ownEntityIds = new Set(ownEntities.map((e) => e.id));
  const ownRelations = graph.relations.filter(
    (r) => ownEntityIds.has(r.sourceEntityId) || ownEntityIds.has(r.targetEntityId),
  );

  const consistency = analyzeArchitectureConsistency(graph, artifacts);
  const traceability = analyzeArchitectureTraceability(graph);

  const consistencyIssues = consistency.issues.filter(
    (issue) =>
      issue.affectedArtifactIds.includes(artifactId) ||
      issue.affectedEntityIds.some((id) => ownEntityIds.has(id)),
  );
  const traceabilityGaps = traceability.gaps.filter((gap) => ownEntityIds.has(gap.entityId));

  // Coverage = connectedness of the artifact's entities + their confidence.
  let coverageScore = 0;
  if (ownEntities.length > 0) {
    const connectedIds = new Set<string>();
    for (const relation of ownRelations) {
      connectedIds.add(relation.sourceEntityId);
      connectedIds.add(relation.targetEntityId);
    }
    const connectedness =
      ownEntities.filter((e) => connectedIds.has(e.id)).length / ownEntities.length;
    const avgConfidence =
      ownEntities.reduce((sum, e) => sum + e.confidence, 0) / ownEntities.length;
    coverageScore = Math.round(connectedness * 55 + avgConfidence * 45);
  }

  const hasCritical = consistencyIssues.some((i) => i.severity === 'critical');
  const hasHigh = consistencyIssues.some((i) => i.severity === 'high');
  const shouldBlock = hasCritical;
  const shouldWarn = !shouldBlock && (hasHigh || ownEntities.length === 0 || coverageScore < 45 || traceabilityGaps.length > 0);

  let recommendation: string;
  if (ownEntities.length === 0) {
    recommendation =
      'El artefacto no aporta entidades al grafo de conocimiento. Enriquécelo con conceptos clave o regenéralo con el contexto del grafo.';
  } else if (shouldBlock) {
    recommendation =
      'Hay inconsistencias críticas asociadas a este artefacto. Resuélvelas antes de aprobarlo o exportarlo.';
  } else if (shouldWarn) {
    recommendation =
      'El artefacto está parcialmente alineado con el grafo. Revisa las inconsistencias y vacíos de trazabilidad señalados.';
  } else {
    recommendation = 'El artefacto está bien integrado en el grafo de conocimiento arquitectónico.';
  }

  return {
    artifactId,
    detectedEntityIds: ownEntities.map((e) => e.id),
    detectedRelationIds: ownRelations.map((r) => r.id),
    coverageScore: Math.max(0, Math.min(100, coverageScore)),
    consistencyIssues,
    traceabilityGaps,
    recommendation,
    shouldWarn,
    shouldBlock,
  };
};

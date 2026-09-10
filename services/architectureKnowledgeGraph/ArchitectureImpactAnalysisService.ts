/**
 * Architecture impact analysis (Task 9).
 *
 * Given a change to an entity, a relation or an artifact, walks the knowledge
 * graph to answer: which artifacts are impacted, which entities / relations
 * are related, how severe the impact is, whether downstream artifacts should
 * be regenerated and whether a human must review the change.
 *
 * Pure read over the graph — never mutates state, never throws.
 */

import type {
  ArchitectureEntity,
  ArchitectureGraph,
  ArchitectureImpactedArtifact,
  ArchitectureImpactRequest,
  ArchitectureImpactResult,
  ArchitectureIssueSeverity,
  ArchitectureRelation,
} from './ArchitectureKnowledgeGraphTypes';
import { trackGraphEvent } from './ArchitectureGraphObservability';

const SEVERITY_RANK: Record<ArchitectureIssueSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

const escalate = (
  a: ArchitectureIssueSeverity,
  b: ArchitectureIssueSeverity,
): ArchitectureIssueSeverity => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

/** Entity types whose change tends to ripple widely. */
const HIGH_IMPACT_TYPES = new Set<ArchitectureEntity['type']>([
  'api',
  'integration',
  'externalSystem',
  'dataEntity',
  'dataStore',
  'database',
  'decision',
  'boundedContext',
]);

interface ImpactIndex {
  byId: Map<string, ArchitectureEntity>;
  adjacency: Map<string, ArchitectureRelation[]>;
}

const indexGraph = (graph: ArchitectureGraph): ImpactIndex => {
  const adjacency = new Map<string, ArchitectureRelation[]>();
  for (const relation of graph.relations) {
    const forSource = adjacency.get(relation.sourceEntityId) ?? [];
    forSource.push(relation);
    adjacency.set(relation.sourceEntityId, forSource);
    const forTarget = adjacency.get(relation.targetEntityId) ?? [];
    forTarget.push(relation);
    adjacency.set(relation.targetEntityId, forTarget);
  }
  return { byId: new Map(graph.entities.map((e) => [e.id, e])), adjacency };
};

/** Breadth-first walk that collects entities and relations within `maxDepth`. */
const walk = (
  index: ImpactIndex,
  seedIds: string[],
  maxDepth: number,
): { entityIds: Set<string>; relationIds: Set<string> } => {
  const entityIds = new Set<string>(seedIds);
  const relationIds = new Set<string>();
  let frontier = [...seedIds];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth += 1) {
    const next: string[] = [];
    for (const entityId of frontier) {
      for (const relation of index.adjacency.get(entityId) ?? []) {
        relationIds.add(relation.id);
        const other =
          relation.sourceEntityId === entityId ? relation.targetEntityId : relation.sourceEntityId;
        if (!entityIds.has(other)) {
          entityIds.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return { entityIds, relationIds };
};

const artifactsForEntities = (
  graph: ArchitectureGraph,
  entityIds: Set<string>,
): Map<string, { entity: ArchitectureEntity; artifactType?: ArchitectureImpactedArtifact['artifactType'] }> => {
  const result = new Map<string, { entity: ArchitectureEntity; artifactType?: ArchitectureImpactedArtifact['artifactType'] }>();
  for (const entity of graph.entities) {
    if (!entityIds.has(entity.id)) continue;
    for (const ref of entity.sourceRefs) {
      if (!ref.artifactId) continue;
      if (!result.has(ref.artifactId)) {
        result.set(ref.artifactId, { entity, artifactType: ref.artifactType });
      }
    }
  }
  return result;
};

/**
 * Analyses the impact of changing a graph element. Always returns a result;
 * `resolved` is `false` when the target id is unknown to the graph.
 */
export const analyzeArchitectureImpact = (
  graph: ArchitectureGraph,
  request: ArchitectureImpactRequest,
): ArchitectureImpactResult => {
  const maxDepth = Math.max(1, Math.min(5, request.maxDepth ?? 2));
  const index = indexGraph(graph);
  const generatedAt = graph.lastBuiltAt;

  const baseResult = (resolved: boolean): ArchitectureImpactResult => ({
    request,
    generatedAt,
    resolved,
    impactedArtifactIds: [],
    impactedArtifacts: [],
    relatedEntityIds: [],
    relatedRelationIds: [],
    severity: 'info',
    reasons: [],
    recommendations: [],
    requiresArtifactRegeneration: false,
    requiresHumanReview: false,
  });

  // Resolve the target to a set of seed entity ids.
  let seedIds: string[] = [];
  let originArtifactId: string | undefined;
  let seedEntity: ArchitectureEntity | undefined;

  if (request.kind === 'entity') {
    seedEntity = index.byId.get(request.targetId);
    if (!seedEntity) return baseResult(false);
    seedIds = [seedEntity.id];
  } else if (request.kind === 'relation') {
    const relation = graph.relations.find((r) => r.id === request.targetId);
    if (!relation) return baseResult(false);
    seedIds = [relation.sourceEntityId, relation.targetEntityId];
  } else {
    originArtifactId = request.targetId;
    seedIds = graph.entities
      .filter((entity) => entity.sourceRefs.some((ref) => ref.artifactId === request.targetId))
      .map((entity) => entity.id);
    if (seedIds.length === 0) return baseResult(false);
  }

  const { entityIds, relationIds } = walk(index, seedIds, maxDepth);
  const artifactMap = artifactsForEntities(graph, entityIds);

  const impactedArtifacts: ArchitectureImpactedArtifact[] = [];
  let severity: ArchitectureIssueSeverity = 'low';
  const reasons: string[] = [];

  const seedCriticality = seedEntity?.criticality ?? 'medium';
  const seedIsHighImpact = seedEntity ? HIGH_IMPACT_TYPES.has(seedEntity.type) : seedIds.length > 1;
  if (seedCriticality === 'critical' || seedCriticality === 'high') severity = escalate(severity, 'high');
  if (seedIsHighImpact) severity = escalate(severity, 'high');

  artifactMap.forEach((info, artifactId) => {
    if (artifactId === originArtifactId) return;
    const artifactSeverity: ArchitectureIssueSeverity = HIGH_IMPACT_TYPES.has(info.entity.type)
      ? 'high'
      : 'medium';
    severity = escalate(severity, artifactSeverity);
    impactedArtifacts.push({
      artifactId,
      artifactType: info.artifactType,
      reason: `Contiene la entidad relacionada "${info.entity.name}" (${info.entity.type}).`,
      severity: artifactSeverity,
    });
  });

  if (impactedArtifacts.length >= 4) severity = escalate(severity, 'high');
  if (impactedArtifacts.length === 0) severity = 'low';

  if (seedEntity) {
    reasons.push(
      `El cambio parte de "${seedEntity.name}" (${seedEntity.type}, criticidad ${seedEntity.criticality}).`,
    );
  }
  reasons.push(
    `Se identificaron ${entityIds.size - seedIds.length} entidades y ${relationIds.size} relaciones conectadas (profundidad ${maxDepth}).`,
  );
  reasons.push(`${impactedArtifacts.length} artefacto(s) podrían requerir actualización.`);

  const recommendations: string[] = [];
  if (impactedArtifacts.length > 0) {
    recommendations.push('Revisa los artefactos impactados y verifica que sigan siendo coherentes con el cambio.');
  }
  if (seedIsHighImpact) {
    recommendations.push('El elemento es de alto impacto: comunica el cambio y actualiza diagramas, NFR y pruebas asociadas.');
  }
  if (relationIds.size > 0) {
    recommendations.push('Confirma que las relaciones conectadas (protocolos, dependencias) sigan vigentes.');
  }
  if (recommendations.length === 0) {
    recommendations.push('El cambio parece aislado: aun así, valida la trazabilidad antes de cerrarlo.');
  }

  const requiresArtifactRegeneration =
    impactedArtifacts.length > 0 && (severity === 'high' || severity === 'critical');
  const requiresHumanReview = severity === 'high' || severity === 'critical' || impactedArtifacts.length >= 3;

  trackGraphEvent('graph.impact.analysis.completed', `${impactedArtifacts.length} artefactos impactados`, {
    projectId: graph.projectId,
    kind: request.kind,
    targetId: request.targetId,
    impactedArtifacts: impactedArtifacts.length,
    severity,
  });

  return {
    request,
    generatedAt,
    resolved: true,
    impactedArtifactIds: impactedArtifacts.map((a) => a.artifactId),
    impactedArtifacts: impactedArtifacts.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]),
    relatedEntityIds: Array.from(entityIds).filter((id) => !seedIds.includes(id)),
    relatedRelationIds: Array.from(relationIds),
    severity,
    reasons,
    recommendations,
    requiresArtifactRegeneration,
    requiresHumanReview,
  };
};

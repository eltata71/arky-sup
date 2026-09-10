/**
 * Architecture traceability engine (Task 8).
 *
 * Provides bidirectional traceability over the knowledge graph: which
 * artifacts support an entity, which entities live in an artifact, which
 * requirements/risks/decisions lack downstream coverage, and the full set of
 * traceability links (requirement ↔ test, risk ↔ mitigation, decision ↔
 * impacted component, …).
 *
 * Every function is a pure read over the graph — it never mutates state.
 */

import type {
  ArchitectureEntity,
  ArchitectureGraph,
  ArchitectureRelation,
  ArchitectureTraceabilityGap,
  ArchitectureTraceabilityGapType,
  ArchitectureTraceabilityLink,
  ArchitectureTraceabilityReport,
  ArchitectureIssueSeverity,
} from './ArchitectureKnowledgeGraphTypes';
import { trackGraphEvent } from './ArchitectureGraphObservability';

const REQUIREMENT_TYPES = new Set<ArchitectureEntity['type']>([
  'requirement',
  'functionalRequirement',
  'nonFunctionalRequirement',
  'userStory',
  'useCase',
]);

/** Relation types that count as "traceable" links. */
const TRACE_RELATION_TYPES = new Set<ArchitectureRelation['type']>([
  'tracesTo',
  'satisfies',
  'implements',
  'validates',
  'mitigates',
  'derivedFrom',
  'impacts',
]);

interface RelationIndex {
  outgoing: Map<string, ArchitectureRelation[]>;
  incoming: Map<string, ArchitectureRelation[]>;
  byId: Map<string, ArchitectureEntity>;
}

const indexGraph = (graph: ArchitectureGraph): RelationIndex => {
  const outgoing = new Map<string, ArchitectureRelation[]>();
  const incoming = new Map<string, ArchitectureRelation[]>();
  for (const relation of graph.relations) {
    const out = outgoing.get(relation.sourceEntityId) ?? [];
    out.push(relation);
    outgoing.set(relation.sourceEntityId, out);
    const inc = incoming.get(relation.targetEntityId) ?? [];
    inc.push(relation);
    incoming.set(relation.targetEntityId, inc);
  }
  return { outgoing, incoming, byId: new Map(graph.entities.map((e) => [e.id, e])) };
};

const neighborsOfType = (
  index: RelationIndex,
  entityId: string,
  relationTypes: ReadonlySet<ArchitectureRelation['type']>,
  entityTypes?: ReadonlySet<ArchitectureEntity['type']>,
): ArchitectureEntity[] => {
  const result: ArchitectureEntity[] = [];
  const consider = (relation: ArchitectureRelation, otherId: string): void => {
    if (!relationTypes.has(relation.type)) return;
    const other = index.byId.get(otherId);
    if (!other) return;
    if (entityTypes && !entityTypes.has(other.type)) return;
    result.push(other);
  };
  for (const relation of index.outgoing.get(entityId) ?? []) consider(relation, relation.targetEntityId);
  for (const relation of index.incoming.get(entityId) ?? []) consider(relation, relation.sourceEntityId);
  return result;
};

/** Which artifacts contributed evidence for an entity (bidirectional read). */
export const getArtifactsSupportingEntity = (graph: ArchitectureGraph, entityId: string): string[] => {
  const entity = graph.entities.find((e) => e.id === entityId);
  if (!entity) return [];
  return Array.from(
    new Set(entity.sourceRefs.map((ref) => ref.artifactId).filter((id): id is string => Boolean(id))),
  );
};

/** Which entities an artifact contributed to the graph. */
export const getEntitiesInArtifact = (graph: ArchitectureGraph, artifactId: string): ArchitectureEntity[] =>
  graph.entities.filter((entity) => entity.sourceRefs.some((ref) => ref.artifactId === artifactId));

/** Requirements with no downstream traceability link. */
export const getRequirementsWithoutCoverage = (graph: ArchitectureGraph): ArchitectureEntity[] => {
  const index = indexGraph(graph);
  return graph.entities.filter((entity) => {
    if (!REQUIREMENT_TYPES.has(entity.type)) return false;
    return neighborsOfType(index, entity.id, TRACE_RELATION_TYPES).length === 0;
  });
};

/** Risks with no `mitigates` relation. */
export const getRisksWithoutMitigation = (graph: ArchitectureGraph): ArchitectureEntity[] => {
  const index = indexGraph(graph);
  return graph.entities.filter((entity) => {
    if (entity.type !== 'risk') return false;
    return neighborsOfType(index, entity.id, new Set(['mitigates'])).length === 0;
  });
};

/** Decisions that declare no impacted component / artifact. */
export const getDecisionsWithoutImpact = (graph: ArchitectureGraph): ArchitectureEntity[] => {
  const index = indexGraph(graph);
  return graph.entities.filter((entity) => {
    if (entity.type !== 'decision') return false;
    return neighborsOfType(index, entity.id, new Set(['impacts', 'constrains', 'derivedFrom'])).length === 0;
  });
};

/** Every traceability link in the graph. */
export const getTraceabilityLinks = (graph: ArchitectureGraph): ArchitectureTraceabilityLink[] =>
  graph.relations
    .filter((relation) => TRACE_RELATION_TYPES.has(relation.type))
    .map((relation) => ({
      fromEntityId: relation.sourceEntityId,
      toEntityId: relation.targetEntityId,
      relationId: relation.id,
      relationType: relation.type,
    }));

let gapCounter = 0;
const makeGap = (
  type: ArchitectureTraceabilityGapType,
  severity: ArchitectureIssueSeverity,
  entity: ArchitectureEntity,
  message: string,
  recommendation: string,
): ArchitectureTraceabilityGap => {
  gapCounter += 1;
  return {
    id: `trace-gap-${type}-${gapCounter}`,
    type,
    severity,
    entityId: entity.id,
    entityName: entity.name,
    message,
    recommendation,
  };
};

/**
 * Full traceability analysis: discovers gaps and computes coverage ratios.
 * Pure — never throws.
 */
export const analyzeArchitectureTraceability = (
  graph: ArchitectureGraph,
): ArchitectureTraceabilityReport => {
  gapCounter = 0;
  const index = indexGraph(graph);
  const gaps: ArchitectureTraceabilityGap[] = [];

  const requirements = graph.entities.filter((e) => REQUIREMENT_TYPES.has(e.type));
  const risks = graph.entities.filter((e) => e.type === 'risk');

  let coveredRequirements = 0;
  for (const requirement of requirements) {
    const links = neighborsOfType(index, requirement.id, TRACE_RELATION_TYPES);
    if (links.length > 0) coveredRequirements += 1;

    const tests = neighborsOfType(index, requirement.id, new Set(['tracesTo', 'validates']), new Set(['testCase']));
    if (tests.length === 0 && requirement.type !== 'nonFunctionalRequirement') {
      gaps.push(
        makeGap(
          'requirement-without-test',
          'high',
          requirement,
          `"${requirement.name}" no tiene casos de prueba que lo verifiquen.`,
          'Crea casos de prueba para el requerimiento y enlázalos en la matriz de trazabilidad.',
        ),
      );
    }
    if (getArtifactsSupportingEntity(graph, requirement.id).length <= 1 && links.length === 0) {
      gaps.push(
        makeGap(
          'requirement-without-artifact',
          'medium',
          requirement,
          `"${requirement.name}" no está referenciado por ningún artefacto de diseño.`,
          'Refleja el requerimiento en el diseño (diagramas, SDD) y enlázalo.',
        ),
      );
    }
    if (requirement.type === 'nonFunctionalRequirement') {
      const quality = neighborsOfType(index, requirement.id, new Set(['satisfies', 'validates', 'constrains']), new Set(['qualityAttribute']));
      if (quality.length === 0) {
        gaps.push(
          makeGap(
            'nfr-without-quality-attribute',
            'medium',
            requirement,
            `El NFR "${requirement.name}" no está vinculado a un atributo de calidad.`,
            'Asocia el NFR a un atributo de calidad (rendimiento, seguridad, …) con su métrica.',
          ),
        );
      }
    }
    if (requirement.type === 'useCase') {
      const actors = neighborsOfType(index, requirement.id, new Set(['uses', 'tracesTo', 'relatedTo']), new Set(['actor']));
      if (actors.length === 0) {
        gaps.push(
          makeGap(
            'use-case-without-actor',
            'low',
            requirement,
            `El caso de uso "${requirement.name}" no tiene un actor asociado.`,
            'Vincula el caso de uso al actor o rol que lo ejecuta.',
          ),
        );
      }
    }
  }

  let mitigatedRisks = 0;
  for (const risk of risks) {
    const mitigations = neighborsOfType(index, risk.id, new Set(['mitigates']));
    if (mitigations.length > 0) {
      mitigatedRisks += 1;
    } else {
      gaps.push(
        makeGap(
          'risk-without-mitigation',
          'high',
          risk,
          `El riesgo "${risk.name}" no tiene una mitigación trazable.`,
          'Define y enlaza una mitigación concreta para el riesgo.',
        ),
      );
    }
  }

  for (const decision of graph.entities.filter((e) => e.type === 'decision')) {
    const impacted = neighborsOfType(index, decision.id, new Set(['impacts', 'constrains']));
    if (impacted.length === 0) {
      gaps.push(
        makeGap(
          'decision-without-impacted-entity',
          'medium',
          decision,
          `La decisión "${decision.name}" no declara entidades impactadas.`,
          'Enlaza la decisión a los componentes o artefactos que afecta.',
        ),
      );
    }
  }

  for (const dataEntity of graph.entities.filter((e) => e.type === 'dataEntity')) {
    const stores = neighborsOfType(index, dataEntity.id, new Set(['persists', 'reads', 'writes', 'belongsTo']), new Set(['dataStore', 'database']));
    if (stores.length === 0) {
      gaps.push(
        makeGap(
          'data-entity-without-store',
          'low',
          dataEntity,
          `La entidad de datos "${dataEntity.name}" no está asociada a un almacén de datos.`,
          'Indica en qué base de datos o almacén persiste la entidad.',
        ),
      );
    }
  }

  for (const event of graph.entities.filter((e) => e.type === 'event' || e.type === 'domainEvent')) {
    const consumers = neighborsOfType(index, event.id, new Set(['consumes']));
    if (consumers.length === 0) {
      gaps.push(
        makeGap(
          'event-without-consumer',
          'medium',
          event,
          `El evento "${event.name}" no tiene un consumidor identificado.`,
          'Modela qué componente consume el evento para cerrar el flujo.',
        ),
      );
    }
  }

  if (gaps.length > 0) {
    trackGraphEvent('graph.traceability.gap.detected', `${gaps.length} vacíos de trazabilidad`, {
      projectId: graph.projectId,
      count: gaps.length,
    });
  }

  return {
    projectId: graph.projectId,
    generatedAt: graph.lastBuiltAt,
    gaps,
    requirementCoverage: requirements.length > 0 ? coveredRequirements / requirements.length : 1,
    riskCoverage: risks.length > 0 ? mitigatedRisks / risks.length : 1,
    linkCount: getTraceabilityLinks(graph).length,
  };
};

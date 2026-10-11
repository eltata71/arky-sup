/**
 * Traceability chain (14.2): requirement → decision → artifact, read only
 * from ids. Pure and total; never mutates the graph.
 *
 * Honesty rules: a relation whose endpoint does not resolve is reported as a
 * finding, never dropped; "no evidence" is a gap, never a covered link.
 */

import type {
  ArchitectureEntity,
  ArchitectureImpactResult,
  ArchitectureGraph,
  ArchitectureIssueSeverity,
  ArchitectureRelation,
} from './ArchitectureKnowledgeGraphTypes';
import { analyzeArchitectureImpact } from './ArchitectureImpactAnalysisService';

const REQUIREMENT_TYPES = new Set<ArchitectureEntity['type']>([
  'requirement',
  'functionalRequirement',
  'nonFunctionalRequirement',
  'userStory',
  'useCase',
]);

const REALIZATION_RELATIONS = new Set<ArchitectureRelation['type']>([
  'impacts',
  'constrains',
  'implements',
  'satisfies',
  'derivedFrom',
  'tracesTo',
]);

const NOT_A_REALIZATION = new Set<ArchitectureEntity['type']>([
  ...REQUIREMENT_TYPES,
  'decision',
  'risk',
  'mitigation',
  'testCase',
  'assumption',
]);

export type TraceabilityChainFindingType =
  | 'requirement-without-decision'
  | 'decision-without-artifact'
  | 'broken-relation'
  | 'broken-artifact-reference';

export interface TraceabilityChainFinding {
  id: string;
  type: TraceabilityChainFindingType;
  severity: ArchitectureIssueSeverity;
  /** Entity the finding hangs from; empty for a relation with no live end. */
  entityId: string;
  subject: string;
  message: string;
  recommendation: string;
}

export interface RequirementChain {
  requirement: ArchitectureEntity;
  decisions: ArchitectureEntity[];
  artifactIds: string[];
}

export interface TraceabilityChainReport {
  projectId: string;
  chains: RequirementChain[];
  findings: TraceabilityChainFinding[];
}

export interface EntityExplanation {
  resolved: boolean;
  entity: ArchitectureEntity | null;
  /** Artifacts whose content produced the entity. */
  originArtifactIds: string[];
  /** What it answers to: requirements, decisions, constraints, risks. */
  drivers: ArchitectureEntity[];
  /** What realises it. */
  realizations: ArchitectureEntity[];
  impact: ArchitectureImpactResult | null;
}

const artifactIdsOf = (entity: ArchitectureEntity): string[] =>
  entity.sourceRefs.map((ref) => ref.artifactId).filter((id): id is string => Boolean(id));

const neighbors = (
  graph: ArchitectureGraph,
  byId: Map<string, ArchitectureEntity>,
  entityId: string,
  relationTypes?: ReadonlySet<ArchitectureRelation['type']>,
): ArchitectureEntity[] => {
  const seen = new Set<string>();
  const result: ArchitectureEntity[] = [];
  for (const relation of graph.relations) {
    if (relationTypes && !relationTypes.has(relation.type)) continue;
    const otherId =
      relation.sourceEntityId === entityId
        ? relation.targetEntityId
        : relation.targetEntityId === entityId
          ? relation.sourceEntityId
          : null;
    if (!otherId || seen.has(otherId)) continue;
    const other = byId.get(otherId);
    if (!other) continue;
    seen.add(otherId);
    result.push(other);
  }
  return result;
};

export const analyzeTraceabilityChains = (
  graph: ArchitectureGraph,
  options: { knownArtifactIds?: readonly string[] } = {},
): TraceabilityChainReport => {
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const findings: TraceabilityChainFinding[] = [];
  const chains: RequirementChain[] = [];
  let counter = 0;
  const push = (f: Omit<TraceabilityChainFinding, 'id'>): void => {
    counter += 1;
    findings.push({ id: `chain-${f.type}-${counter}`, ...f });
  };

  for (const relation of graph.relations) {
    if (!byId.has(relation.sourceEntityId) || !byId.has(relation.targetEntityId)) {
      push({
        type: 'broken-relation',
        severity: 'high',
        entityId: byId.has(relation.sourceEntityId)
          ? relation.sourceEntityId
          : byId.has(relation.targetEntityId)
            ? relation.targetEntityId
            : '',
        subject: relation.label ?? relation.type,
        message: `La relación «${relation.label ?? relation.type}» apunta a una entidad que ya no existe.`,
        recommendation: 'Recalcula el grafo o vuelve a enlazar la relación con una entidad vigente.',
      });
    }
  }

  const known = options.knownArtifactIds ? new Set(options.knownArtifactIds) : null;
  if (known) {
    for (const entity of graph.entities) {
      const missing = Array.from(new Set(artifactIdsOf(entity))).filter((id) => !known.has(id));
      if (missing.length > 0) {
        push({
          type: 'broken-artifact-reference',
          severity: 'medium',
          entityId: entity.id,
          subject: entity.name,
          message: `«${entity.name}» cita ${missing.length} artefacto(s) que ya no existen.`,
          recommendation: 'Recalcula el grafo para retirar la evidencia de artefactos eliminados.',
        });
      }
    }
  }

  const decisions = graph.entities.filter((e) => e.type === 'decision');

  for (const requirement of graph.entities.filter((e) => REQUIREMENT_TYPES.has(e.type))) {
    const linked = neighbors(graph, byId, requirement.id).filter((e) => e.type === 'decision');
    const artifactIds = new Set<string>();
    for (const decision of linked) {
      for (const real of neighbors(graph, byId, decision.id, REALIZATION_RELATIONS)) {
        if (!NOT_A_REALIZATION.has(real.type)) artifactIdsOf(real).forEach((id) => artifactIds.add(id));
      }
    }
    chains.push({ requirement, decisions: linked, artifactIds: Array.from(artifactIds) });
    if (linked.length === 0) {
      push({
        type: 'requirement-without-decision',
        severity: 'medium',
        entityId: requirement.id,
        subject: requirement.name,
        message: `El requisito «${requirement.name}» no tiene ninguna decisión que lo atienda.`,
        recommendation: 'Registra la decisión (ADR) que responde al requisito y enlázala.',
      });
    }
  }

  for (const decision of decisions) {
    const realized = neighbors(graph, byId, decision.id, REALIZATION_RELATIONS).filter(
      (e) => !NOT_A_REALIZATION.has(e.type) && artifactIdsOf(e).length > 0,
    );
    if (realized.length === 0) {
      push({
        type: 'decision-without-artifact',
        severity: 'high',
        entityId: decision.id,
        subject: decision.name,
        message: `La decisión «${decision.name}» no se refleja en ningún artefacto de diseño.`,
        recommendation: 'Muestra la decisión en un diagrama o documento: un componente que la materialice.',
      });
    }
  }

  return { projectId: graph.projectId, chains, findings };
};

export const explainEntity = (graph: ArchitectureGraph, entityId: string): EntityExplanation => {
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const entity = byId.get(entityId);
  if (!entity) {
    return { resolved: false, entity: null, originArtifactIds: [], drivers: [], realizations: [], impact: null };
  }
  const connected = neighbors(graph, byId, entityId);
  const drivers = connected.filter((e) => NOT_A_REALIZATION.has(e.type) && e.type !== 'testCase');
  const realizations = connected.filter((e) => !NOT_A_REALIZATION.has(e.type) || e.type === 'testCase');
  return {
    resolved: true,
    entity,
    originArtifactIds: Array.from(new Set(artifactIdsOf(entity))),
    drivers,
    realizations,
    impact: analyzeArchitectureImpact(graph, { kind: 'entity', targetId: entityId }),
  };
};

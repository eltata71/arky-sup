/**
 * Architecture Knowledge Graph — build orchestrator.
 *
 * Turns a `Project` (description, context surfaces and every artifact) into
 * the canonical {@link ArchitectureGraph}: it runs the deterministic entity /
 * relation extractors, consolidates and deduplicates the signals, then scores
 * the graph and folds in consistency / traceability counts.
 *
 * The build is pure and total — it never throws. On any internal failure it
 * returns a safe empty graph and records the failure in observability, so the
 * rest of Arky Pro keeps working without the graph.
 */

import type { Artifact } from '../../lib/artifacts';

/**
 * Lo que el grafo lee de un proyecto: su descripción, sus superficies de
 * contexto y sus artefactos.
 *
 * Es un puerto, no `Project`. `services/architectureProjects` importa este
 * contexto (lee y guarda el grafo); si éste importara `Project` de vuelta, los
 * dos serían un solo módulo con dos carpetas (F3-07). Cualquier `Project` encaja
 * por estructura, así que ningún llamador cambia.
 */
export interface ArchitectureGraphProjectSource {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly projectContext?: readonly string[];
  readonly agentMemory?: readonly string[];
  readonly initialCapture?: readonly string[];
  readonly linkedBusinessProjects?: readonly string[];
  readonly artifacts?: readonly Artifact[];
}
import { type ArchitectureEntity, type ArchitectureGraph, type ArchitectureGraphArtifactInput, type ArchitectureGraphBuildInput, type ArchitectureGraphQuality, type ArchitectureGraphStatistics, type ArchitectureRelation, ARCHITECTURE_GRAPH_SCHEMA_VERSION } from './ArchitectureKnowledgeGraphTypes';
import { architectureEntityExtractor } from './ArchitectureEntityExtractor';
import { architectureRelationExtractor } from './ArchitectureRelationExtractor';
import { consolidateEntities, consolidateRelations } from './ArchitectureGraphDeduplication';
import { analyzeArchitectureConsistency } from './ArchitectureConsistencyService';
import { analyzeArchitectureTraceability } from './ArchitectureTraceabilityService';
import { reportGraphFailure, trackGraphEvent } from './ArchitectureGraphObservability';
import {
  computeArchitectureGraphSignature,
  resolveArchitectureGraphFreshness,
  type ArchitectureGraphFreshness,
} from './ArchitectureGraphFreshness';

const nowOr = (value?: string): string => value ?? new Date().toISOString();

/** Builds a valid, empty graph — the safe baseline for a new/legacy project. */
export const createEmptyArchitectureGraph = (projectId: string, now?: string): ArchitectureGraph => {
  const at = nowOr(now);
  return {
    projectId,
    version: ARCHITECTURE_GRAPH_SCHEMA_VERSION,
    buildId: `akg-${projectId}-${at}`,
    lastBuiltAt: at,
    entities: [],
    relations: [],
    quality: {
      score: 0,
      averageConfidence: 0,
      artifactCoverage: 0,
      consistencyIssueCount: 0,
      traceabilityGapCount: 0,
      summary: 'El grafo está vacío: aún no se detectó conocimiento arquitectónico.',
    },
    statistics: {
      entityCount: 0,
      relationCount: 0,
      sourceArtifactCount: 0,
      byEntityType: {},
      byRelationType: {},
      lowConfidenceEntityCount: 0,
      candidateDuplicateCount: 0,
      orphanEntityCount: 0,
    },
  };
};

/** Maps a `Project` to the decoupled build input the extractors consume. */
export const buildGraphInputFromProject = (
  project: ArchitectureGraphProjectSource,
  options: { globalContext?: string[]; now?: string; previousGraph?: ArchitectureGraph } = {},
): ArchitectureGraphBuildInput => ({
  projectId: project.id,
  projectName: project.name,
  projectDescription: project.description,
  projectContext: [...(project.projectContext ?? [])],
  agentMemory: [...(project.agentMemory ?? [])],
  initialCapture: [...(project.initialCapture ?? [])],
  globalContext: [
    ...(options.globalContext ?? []),
    ...(project.linkedBusinessProjects ?? []).map(
      (projectId) => `Business traceability reference: ${projectId}`,
    ),
  ],
  artifacts: (project.artifacts ?? []).map(
    (artifact): ArchitectureGraphArtifactInput => ({
      id: artifact.id,
      name: artifact.name,
      type: artifact.type,
      objective: artifact.objective,
      representation: artifact.representation,
      keyConcepts: artifact.keyConcepts,
      content: artifact.content,
      ir: artifact.ir,
      artifactEnvelope: artifact.artifactEnvelope,
      compilation: artifact.compilation,
      generationTrace: artifact.generationTrace,
      artifactMemory: artifact.artifactMemory,
      createdAt: artifact.createdAt,
    } as ArchitectureGraphArtifactInput),
  ),
  now: options.now,
  previousGraph: options.previousGraph,
});

const computeStatistics = (
  entities: ArchitectureEntity[],
  relations: ArchitectureRelation[],
): ArchitectureGraphStatistics => {
  const byEntityType: ArchitectureGraphStatistics['byEntityType'] = {};
  const byRelationType: ArchitectureGraphStatistics['byRelationType'] = {};
  const sourceArtifacts = new Set<string>();
  let lowConfidence = 0;
  let candidateDuplicates = 0;

  for (const entity of entities) {
    byEntityType[entity.type] = (byEntityType[entity.type] ?? 0) + 1;
    if (entity.confidence < 0.4) lowConfidence += 1;
    if (entity.status === 'candidate-duplicate') candidateDuplicates += 1;
    for (const ref of entity.sourceRefs) {
      if (ref.artifactId) sourceArtifacts.add(ref.artifactId);
    }
  }
  for (const relation of relations) {
    byRelationType[relation.type] = (byRelationType[relation.type] ?? 0) + 1;
  }

  const connected = new Set<string>();
  for (const relation of relations) {
    connected.add(relation.sourceEntityId);
    connected.add(relation.targetEntityId);
  }
  const orphanEntityCount = entities.filter((entity) => !connected.has(entity.id)).length;

  return {
    entityCount: entities.length,
    relationCount: relations.length,
    sourceArtifactCount: sourceArtifacts.size,
    byEntityType,
    byRelationType,
    lowConfidenceEntityCount: lowConfidence,
    candidateDuplicateCount: candidateDuplicates,
    orphanEntityCount,
  };
};

const computeQuality = (
  entities: ArchitectureEntity[],
  // Se recibe y no se lee: el recuento de relaciones ya viene dentro de
  // `statistics`, y leerlo dos veces sería tener dos respuestas a la misma
  // pregunta. Se conserva en la firma porque el orden de los argumentos es el
  // que usa el único llamante, y quitarlo aquí es un cambio que no mejora nada
  // y que se puede aplicar mal.
  _relations: ArchitectureRelation[],
  statistics: ArchitectureGraphStatistics,
  totalArtifacts: number,
  consistencyIssueCount: number,
  traceabilityGapCount: number,
): ArchitectureGraphQuality => {
  if (entities.length === 0) {
    return {
      score: 0,
      averageConfidence: 0,
      artifactCoverage: 0,
      consistencyIssueCount,
      traceabilityGapCount,
      summary: 'El grafo está vacío: aún no se detectó conocimiento arquitectónico.',
    };
  }
  const averageConfidence =
    entities.reduce((sum, entity) => sum + entity.confidence, 0) / entities.length;
  const artifactCoverage =
    totalArtifacts > 0 ? Math.min(1, statistics.sourceArtifactCount / totalArtifacts) : 0;
  const connectivity =
    entities.length > 0 ? 1 - statistics.orphanEntityCount / entities.length : 0;
  const issuesPenalty = Math.min(
    1,
    (consistencyIssueCount + traceabilityGapCount * 0.5) / Math.max(8, entities.length),
  );
  const score = Math.round(
    averageConfidence * 35 +
      artifactCoverage * 25 +
      connectivity * 20 +
      (1 - issuesPenalty) * 20,
  );

  const summary =
    score >= 80
      ? 'Grafo arquitectónico sólido: alta confianza y buena cobertura entre artefactos.'
      : score >= 55
        ? 'Grafo utilizable: revisa inconsistencias y vacíos de trazabilidad para reforzarlo.'
        : 'Grafo incipiente: aporta más artefactos y contexto para enriquecer el conocimiento.';

  return {
    score: Math.max(0, Math.min(100, score)),
    averageConfidence,
    artifactCoverage,
    consistencyIssueCount,
    traceabilityGapCount,
    summary,
  };
};

/**
 * Builds the canonical Architecture Knowledge Graph from a decoupled input.
 * Never throws — on failure returns an empty graph and records the error.
 */
export const buildArchitectureKnowledgeGraph = (
  input: ArchitectureGraphBuildInput,
): ArchitectureGraph => {
  const now = nowOr(input.now);
  // Stamp the graph with the signature of its build inputs *before* the build
  // runs, so even the safe empty fallback returned on failure is `current`
  // for this input and the auto-refresh loop cannot spin retrying it.
  const sourceSignature = computeArchitectureGraphSignature(input);
  trackGraphEvent('graph.build.started', `proyecto ${input.projectId}`, {
    projectId: input.projectId,
    artifactCount: input.artifacts?.length ?? 0,
  });

  try {
    const rawEntities = architectureEntityExtractor.extract(input);
    const rawRelations = architectureRelationExtractor.extract(input);
    trackGraphEvent('graph.entity.extracted', `${rawEntities.length} señales de entidad`, {
      projectId: input.projectId,
      count: rawEntities.length,
    });
    trackGraphEvent('graph.relation.extracted', `${rawRelations.length} señales de relación`, {
      projectId: input.projectId,
      count: rawRelations.length,
    });

    const consolidatedEntities = consolidateEntities(
      rawEntities,
      input.projectId,
      now,
      input.previousGraph,
    );
    const { relations, entities } = consolidateRelations(
      rawRelations,
      consolidatedEntities,
      input.projectId,
      now,
      input.previousGraph,
    );

    const duplicateCount = entities.filter((entity) => entity.status === 'candidate-duplicate').length;
    if (duplicateCount > 0) {
      trackGraphEvent('graph.entity.duplicated', `${duplicateCount} posibles duplicados`, {
        projectId: input.projectId,
        count: duplicateCount,
      });
    }

    const statistics = computeStatistics(entities, relations);
    const baseGraph: ArchitectureGraph = {
      projectId: input.projectId,
      version: ARCHITECTURE_GRAPH_SCHEMA_VERSION,
      buildId: `akg-${input.projectId}-${now}`,
      lastBuiltAt: now,
      sourceSignature,
      entities,
      relations,
      quality: createEmptyArchitectureGraph(input.projectId, now).quality,
      statistics,
    };

    const consistency = analyzeArchitectureConsistency(baseGraph, input.artifacts ?? []);
    const traceability = analyzeArchitectureTraceability(baseGraph);
    const quality = computeQuality(
      entities,
      relations,
      statistics,
      input.artifacts?.length ?? 0,
      consistency.issues.length,
      traceability.gaps.length,
    );

    const graph: ArchitectureGraph = { ...baseGraph, quality };
    trackGraphEvent('graph.build.completed', `${entities.length} entidades, ${relations.length} relaciones`, {
      projectId: input.projectId,
      entityCount: entities.length,
      relationCount: relations.length,
      score: quality.score,
    });
    return graph;
  } catch (error) {
    reportGraphFailure('graph.build.failed', error, { projectId: input.projectId });
    return { ...createEmptyArchitectureGraph(input.projectId, now), sourceSignature };
  }
};

/**
 * Convenience: builds the graph straight from a `Project`.
 *
 * It used to take `includeOfficeContext` and fetch the Office's standards
 * itself — the one import by which the knowledge graph reached up into
 * `services/architectureOffice` and closed the domain component. No production
 * caller ever set it (F5-03); a caller that wants the standards in the
 * signature passes them in `globalContext`, which is what the option did.
 */
export const buildArchitectureKnowledgeGraphForProject = (
  project: ArchitectureGraphProjectSource,
  options: { globalContext?: string[]; now?: string; previousGraph?: ArchitectureGraph } = {},
): ArchitectureGraph => {
  const globalContext = Array.from(new Set(options.globalContext ?? []));
  return buildArchitectureKnowledgeGraph(buildGraphInputFromProject(project, {
    ...options,
    globalContext,
  }));
};

/**
 * Resolves whether a project's persisted graph still reflects its current
 * artifacts. Pure and total — the canonical entry point for the UI, the
 * generation pipeline and the publication pipeline to check graph freshness.
 */
export const resolveProjectArchitectureGraphFreshness = (
  project: ArchitectureGraphProjectSource & { readonly architectureKnowledgeGraph?: ArchitectureGraph },
  options: { globalContext?: string[] } = {},
): ArchitectureGraphFreshness => {
  const globalContext = Array.from(new Set(options.globalContext ?? []));
  return resolveArchitectureGraphFreshness(
    project.architectureKnowledgeGraph,
    computeArchitectureGraphSignature(buildGraphInputFromProject(project, {
      ...options,
      globalContext,
    })),
  );
};

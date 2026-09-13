/**
 * Architecture Knowledge Graph (AKG) — public barrel.
 *
 * The AKG is the persisted, canonical source of architectural knowledge for a
 * project. It is built deterministically from the project surfaces and every
 * artifact, and powers consistency checking, bidirectional traceability,
 * impact analysis and graph-grounded artifact generation.
 *
 * This module is additive and backwards-compatible: it never mutates legacy
 * types and the graph attaches to `Project.architectureKnowledgeGraph` as an
 * optional block. Every entry point is pure and total — it never throws.
 */

export * from './ArchitectureKnowledgeGraphTypes';

export {
  stripAccents,
  normalizeName,
  slugify,
  cleanText,
  truncate,
  tokenize,
  tokenSimilarity,
  isSameEntityName,
  areEntityTypesCompatible,
  pickMoreSpecificType,
  buildEntityId,
  buildRelationId,
  clampConfidence,
} from './ArchitectureGraphNormalization';

export {
  ArchitectureEntityExtractor,
  architectureEntityExtractor,
} from './ArchitectureEntityExtractor';
export {
  ArchitectureRelationExtractor,
  architectureRelationExtractor,
} from './ArchitectureRelationExtractor';
export { consolidateEntities, consolidateRelations } from './ArchitectureGraphDeduplication';

export {
  buildArchitectureKnowledgeGraph,
  buildArchitectureKnowledgeGraphForProject,
  buildGraphInputFromProject,
  createEmptyArchitectureGraph,
  resolveProjectArchitectureGraphFreshness,
} from './ArchitectureKnowledgeGraphService';

export {
  computeArchitectureGraphSignature,
  resolveArchitectureGraphFreshness,
  describeArchitectureGraphFreshness,
  type ArchitectureGraphFreshness,
  type ArchitectureGraphFreshnessDescriptor,
} from './ArchitectureGraphFreshness';

export {
  buildArtifactGenerationGraphContext,
  type ArchitectureGraphGenerationContext,
  type ArchitectureGraphGenerationContextOptions,
} from './ArchitectureGraphGenerationContext';

export { analyzeArchitectureConsistency } from './ArchitectureConsistencyService';

export {
  analyzeArchitectureTraceability,
  getArtifactsSupportingEntity,
  getEntitiesInArtifact,
  getRequirementsWithoutCoverage,
  getRisksWithoutMitigation,
  getDecisionsWithoutImpact,
  getTraceabilityLinks,
} from './ArchitectureTraceabilityService';

export { analyzeArchitectureImpact } from './ArchitectureImpactAnalysisService';

export {
  ARCHITECTURE_GRAPH_PROJECT_FIELD,
  getKnowledgeGraphSubcollectionPath,
  serializeArchitectureGraph,
  deserializeArchitectureGraph,
  readGraphFromProject,
  attachGraphToProject,
  buildGraphUpdatePayload,
} from './ArchitectureGraphPersistenceAdapter';

export { buildArchitectureGraphPromptContext } from './ArchitectureGraphPromptContextBuilder';

export { buildArtifactGraphInsight } from './ArchitectureGraphQualityBridge';

export { migrateArchitectureGraph, needsMigration } from './ArchitectureGraphMigrations';

export {
  validateArchitectureGraph,
  validateEntity,
  validateRelation,
  validateSourceRef,
} from './ArchitectureGraphRuntimeValidation';

export { buildArchitectureGraphReportText } from './ArchitectureGraphReport';

export {
  createSupabaseKnowledgeGraphRepository,
  type SupabaseKnowledgeGraphClientLike,
  type SupabaseKnowledgeGraphRepository,
} from './SupabaseKnowledgeGraphRepository';

export {
  trackGraphEvent,
  reportGraphFailure,
  type ArchitectureGraphEvent,
} from './ArchitectureGraphObservability';

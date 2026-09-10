/**
 * Runtime validation for the Architecture Knowledge Graph (Task 15).
 *
 * The graph can arrive from Firestore, `localStorage` or an older schema
 * version. These hand-rolled validators are the safety net: they discard
 * corrupt entities / relations, apply safe defaults, keep every valid element
 * and never throw — so a malformed graph can never blank the screen.
 */

import type {
  ArchitectureCriticality,
  ArchitectureEntity,
  ArchitectureEntityStatus,
  ArchitectureEntityType,
  ArchitectureGraph,
  ArchitectureGraphQuality,
  ArchitectureGraphStatistics,
  ArchitectureGraphValidationIssue,
  ArchitectureGraphValidationResult,
  ArchitectureRelation,
  ArchitectureRelationType,
  ArchitectureSourceRef,
  ArchitectureSourceType,
} from './ArchitectureKnowledgeGraphTypes';
import { ARCHITECTURE_GRAPH_SCHEMA_VERSION } from './ArchitectureKnowledgeGraphTypes';

const ENTITY_TYPES: ReadonlySet<string> = new Set<ArchitectureEntityType>([
  'actor', 'stakeholder', 'businessCapability', 'businessProcess', 'system',
  'externalSystem', 'application', 'container', 'component', 'module', 'api',
  'event', 'queue', 'topic', 'dataEntity', 'dataStore', 'database',
  'integration', 'requirement', 'functionalRequirement', 'nonFunctionalRequirement',
  'qualityAttribute', 'risk', 'mitigation', 'decision', 'constraint', 'assumption',
  'testCase', 'userStory', 'useCase', 'glossaryTerm', 'domainEvent', 'command',
  'aggregate', 'boundedContext', 'environment', 'deploymentNode', 'securityControl',
  'observabilityControl', 'unknown',
]);

const RELATION_TYPES: ReadonlySet<string> = new Set<ArchitectureRelationType>([
  'uses', 'dependsOn', 'contains', 'exposes', 'calls', 'publishes', 'consumes',
  'persists', 'reads', 'writes', 'owns', 'implements', 'satisfies', 'tracesTo',
  'mitigates', 'impacts', 'constrains', 'belongsTo', 'deployedOn', 'monitors',
  'secures', 'validates', 'duplicates', 'conflictsWith', 'derivedFrom', 'relatedTo',
]);

const SOURCE_TYPES: ReadonlySet<string> = new Set<ArchitectureSourceType>([
  'project-description', 'project-context', 'agent-memory', 'initial-capture',
  'global-context', 'artifact-name', 'artifact-objective', 'artifact-key-concept',
  'artifact-content', 'artifact-ir', 'artifact-envelope', 'artifact-compilation',
  'artifact-generation-trace', 'manual',
]);

const CRITICALITY: ReadonlySet<string> = new Set<ArchitectureCriticality>([
  'low', 'medium', 'high', 'critical',
]);

const ENTITY_STATUS: ReadonlySet<string> = new Set<ArchitectureEntityStatus>([
  'proposed', 'active', 'deprecated', 'candidate-duplicate', 'unverified',
]);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const clamp01 = (value: unknown): number => {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, num));
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const safeMetadata = (value: unknown): Record<string, string | number | boolean> => {
  if (!isObject(value)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      out[key] = entry;
    }
  }
  return out;
};

/** Validates a single source ref, returning `null` when unrecoverable. */
export const validateSourceRef = (input: unknown, now: string): ArchitectureSourceRef | null => {
  if (!isObject(input)) return null;
  const sourceType = SOURCE_TYPES.has(input.sourceType as string)
    ? (input.sourceType as ArchitectureSourceType)
    : 'manual';
  const sourceId = isNonEmptyString(input.sourceId) ? input.sourceId : 'unknown';
  const ref: ArchitectureSourceRef = {
    sourceType,
    sourceId,
    confidence: clamp01(input.confidence),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
  };
  if (typeof input.artifactId === 'string') ref.artifactId = input.artifactId;
  if (typeof input.artifactType === 'string') ref.artifactType = input.artifactType as ArchitectureSourceRef['artifactType'];
  if (typeof input.sectionId === 'string') ref.sectionId = input.sectionId;
  if (typeof input.excerpt === 'string') ref.excerpt = input.excerpt;
  return ref;
};

/** Validates a single entity, returning `null` when unrecoverable. */
export const validateEntity = (
  input: unknown,
  now: string,
  issues: ArchitectureGraphValidationIssue[],
  path: string,
): ArchitectureEntity | null => {
  if (!isObject(input)) {
    issues.push({ path, message: 'entidad no es un objeto' });
    return null;
  }
  if (!isNonEmptyString(input.id) || !isNonEmptyString(input.name)) {
    issues.push({ path, message: 'entidad sin id o nombre' });
    return null;
  }
  const type = ENTITY_TYPES.has(input.type as string)
    ? (input.type as ArchitectureEntityType)
    : 'unknown';
  if (!ENTITY_TYPES.has(input.type as string)) {
    issues.push({ path: `${path}.type`, message: `tipo desconocido normalizado a "unknown"` });
  }
  const sourceRefs = Array.isArray(input.sourceRefs)
    ? input.sourceRefs.map((ref) => validateSourceRef(ref, now)).filter((ref): ref is ArchitectureSourceRef => ref !== null)
    : [];

  return {
    id: input.id,
    projectId: isNonEmptyString(input.projectId) ? input.projectId : 'unknown',
    name: input.name,
    normalizedName: isNonEmptyString(input.normalizedName)
      ? input.normalizedName
      : input.name.toLowerCase(),
    type,
    subtype: typeof input.subtype === 'string' ? input.subtype : undefined,
    description: typeof input.description === 'string' ? input.description : undefined,
    aliases: stringArray(input.aliases),
    sourceRefs,
    confidence: clamp01(input.confidence),
    criticality: CRITICALITY.has(input.criticality as string)
      ? (input.criticality as ArchitectureCriticality)
      : 'medium',
    status: ENTITY_STATUS.has(input.status as string)
      ? (input.status as ArchitectureEntityStatus)
      : 'active',
    tags: stringArray(input.tags),
    metadata: safeMetadata(input.metadata),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  };
};

/** Validates a single relation; needs the set of valid entity ids. */
export const validateRelation = (
  input: unknown,
  validEntityIds: ReadonlySet<string>,
  now: string,
  issues: ArchitectureGraphValidationIssue[],
  path: string,
): ArchitectureRelation | null => {
  if (!isObject(input)) {
    issues.push({ path, message: 'relación no es un objeto' });
    return null;
  }
  if (!isNonEmptyString(input.id)) {
    issues.push({ path, message: 'relación sin id' });
    return null;
  }
  const sourceEntityId = isNonEmptyString(input.sourceEntityId) ? input.sourceEntityId : '';
  const targetEntityId = isNonEmptyString(input.targetEntityId) ? input.targetEntityId : '';
  if (!validEntityIds.has(sourceEntityId) || !validEntityIds.has(targetEntityId)) {
    issues.push({ path, message: 'relación apunta a una entidad inexistente; se descarta' });
    return null;
  }
  const type = RELATION_TYPES.has(input.type as string)
    ? (input.type as ArchitectureRelationType)
    : 'relatedTo';
  const sourceRefs = Array.isArray(input.sourceRefs)
    ? input.sourceRefs.map((ref) => validateSourceRef(ref, now)).filter((ref): ref is ArchitectureSourceRef => ref !== null)
    : [];

  return {
    id: input.id,
    projectId: isNonEmptyString(input.projectId) ? input.projectId : 'unknown',
    sourceEntityId,
    targetEntityId,
    type,
    label: typeof input.label === 'string' ? input.label : undefined,
    description: typeof input.description === 'string' ? input.description : undefined,
    protocol: typeof input.protocol === 'string' ? input.protocol : undefined,
    direction: input.direction === 'bidirectional' ? 'bidirectional' : input.direction === 'unidirectional' ? 'unidirectional' : undefined,
    sourceRefs,
    confidence: clamp01(input.confidence),
    metadata: safeMetadata(input.metadata),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now,
  };
};

const safeStatistics = (value: unknown, entities: ArchitectureEntity[], relations: ArchitectureRelation[]): ArchitectureGraphStatistics => {
  const base = isObject(value) ? value : {};
  return {
    entityCount: typeof base.entityCount === 'number' ? base.entityCount : entities.length,
    relationCount: typeof base.relationCount === 'number' ? base.relationCount : relations.length,
    sourceArtifactCount: typeof base.sourceArtifactCount === 'number' ? base.sourceArtifactCount : 0,
    byEntityType: isObject(base.byEntityType) ? (base.byEntityType as ArchitectureGraphStatistics['byEntityType']) : {},
    byRelationType: isObject(base.byRelationType) ? (base.byRelationType as ArchitectureGraphStatistics['byRelationType']) : {},
    lowConfidenceEntityCount: typeof base.lowConfidenceEntityCount === 'number' ? base.lowConfidenceEntityCount : 0,
    candidateDuplicateCount: typeof base.candidateDuplicateCount === 'number' ? base.candidateDuplicateCount : 0,
    orphanEntityCount: typeof base.orphanEntityCount === 'number' ? base.orphanEntityCount : 0,
  };
};

const safeQuality = (value: unknown): ArchitectureGraphQuality => {
  const base = isObject(value) ? value : {};
  return {
    score: typeof base.score === 'number' ? base.score : 0,
    averageConfidence: clamp01(base.averageConfidence),
    artifactCoverage: clamp01(base.artifactCoverage),
    consistencyIssueCount: typeof base.consistencyIssueCount === 'number' ? base.consistencyIssueCount : 0,
    traceabilityGapCount: typeof base.traceabilityGapCount === 'number' ? base.traceabilityGapCount : 0,
    summary: typeof base.summary === 'string' ? base.summary : 'Grafo sin resumen.',
  };
};

/**
 * Validates a whole graph. Corrupt entities and dangling relations are
 * dropped; everything valid is preserved. Returns `null` only when the graph
 * envelope itself is unsalvageable.
 */
export const validateArchitectureGraph = (input: unknown): ArchitectureGraphValidationResult => {
  const issues: ArchitectureGraphValidationIssue[] = [];
  const now = new Date().toISOString();

  if (!isObject(input)) {
    return { value: null, issues: [{ path: 'graph', message: 'el grafo no es un objeto' }] };
  }
  if (!isNonEmptyString(input.projectId)) {
    return { value: null, issues: [{ path: 'graph.projectId', message: 'projectId ausente' }] };
  }

  const rawEntities = Array.isArray(input.entities) ? input.entities : [];
  const entities: ArchitectureEntity[] = [];
  rawEntities.forEach((raw, index) => {
    const entity = validateEntity(raw, now, issues, `graph.entities[${index}]`);
    if (entity) entities.push(entity);
  });

  const validIds = new Set(entities.map((entity) => entity.id));
  const rawRelations = Array.isArray(input.relations) ? input.relations : [];
  const relations: ArchitectureRelation[] = [];
  rawRelations.forEach((raw, index) => {
    const relation = validateRelation(raw, validIds, now, issues, `graph.relations[${index}]`);
    if (relation) relations.push(relation);
  });

  const graph: ArchitectureGraph = {
    projectId: input.projectId,
    version: typeof input.version === 'number' ? input.version : ARCHITECTURE_GRAPH_SCHEMA_VERSION,
    buildId: isNonEmptyString(input.buildId) ? input.buildId : `akg-${now}`,
    lastBuiltAt: typeof input.lastBuiltAt === 'string' ? input.lastBuiltAt : now,
    entities,
    relations,
    quality: safeQuality(input.quality),
    statistics: safeStatistics(input.statistics, entities, relations),
  };
  // Preserve the freshness signature when present. Its absence is meaningful:
  // a graph with no signature is conservatively treated as stale.
  if (isNonEmptyString(input.sourceSignature)) {
    graph.sourceSignature = input.sourceSignature;
  }

  return { value: graph, issues };
};

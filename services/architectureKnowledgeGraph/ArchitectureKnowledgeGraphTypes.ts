/**
 * Architecture Knowledge Graph (AKG) — canonical contracts.
 *
 * The AKG is the *persisted, canonical source of architectural knowledge* for
 * a project. Where `services/contextGraph` builds an in-memory, prompt-facing
 * slice on demand, the AKG is a durable model that every artifact can read
 * from, enrich and validate against.
 *
 * It is built deterministically from the project description, the project
 * context surfaces and every artifact (name, objective, key concepts, content,
 * `DiagramIR`, envelope, compilation summary and generation trace). It then
 * powers consistency checking, bidirectional traceability and impact analysis.
 *
 * Everything in this module is plain JSON-safe data: no `Date`, no `Map`, no
 * class instances — so the graph is trivially serializable for Firestore /
 * localStorage persistence. This module is additive: it never mutates legacy
 * types and the graph attaches to `Project.architectureKnowledgeGraph` as an
 * optional, backwards-compatible block.
 */

import type { ArtifactType } from '../../types';

/**
 * Bump when the persisted shape changes in a non-backwards-compatible way.
 * `ArchitectureGraphMigrations` upgrades older persisted graphs to this value.
 */
export const ARCHITECTURE_GRAPH_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------------- */
/* Entity & relation taxonomies                                              */
/* ------------------------------------------------------------------------- */

/** Canonical entity taxonomy for the architecture knowledge graph. */
export type ArchitectureEntityType =
  | 'actor'
  | 'stakeholder'
  | 'businessCapability'
  | 'businessProcess'
  | 'system'
  | 'externalSystem'
  | 'application'
  | 'container'
  | 'component'
  | 'module'
  | 'api'
  | 'event'
  | 'queue'
  | 'topic'
  | 'dataEntity'
  | 'dataStore'
  | 'database'
  | 'integration'
  | 'requirement'
  | 'functionalRequirement'
  | 'nonFunctionalRequirement'
  | 'qualityAttribute'
  | 'risk'
  | 'mitigation'
  | 'decision'
  | 'constraint'
  | 'assumption'
  | 'testCase'
  | 'userStory'
  | 'useCase'
  | 'glossaryTerm'
  | 'domainEvent'
  | 'command'
  | 'aggregate'
  | 'boundedContext'
  | 'environment'
  | 'deploymentNode'
  | 'securityControl'
  | 'observabilityControl'
  | 'unknown';

/** Canonical relation taxonomy. */
export type ArchitectureRelationType =
  | 'uses'
  | 'dependsOn'
  | 'contains'
  | 'exposes'
  | 'calls'
  | 'publishes'
  | 'consumes'
  | 'persists'
  | 'reads'
  | 'writes'
  | 'owns'
  | 'implements'
  | 'satisfies'
  | 'tracesTo'
  | 'mitigates'
  | 'impacts'
  | 'constrains'
  | 'belongsTo'
  | 'deployedOn'
  | 'monitors'
  | 'secures'
  | 'validates'
  | 'duplicates'
  | 'conflictsWith'
  | 'derivedFrom'
  | 'relatedTo';

/** Confidence / lifecycle helpers shared across the model. */
export type ArchitectureCriticality = 'low' | 'medium' | 'high' | 'critical';

export type ArchitectureEntityStatus =
  | 'proposed'
  | 'active'
  | 'deprecated'
  | 'candidate-duplicate'
  | 'unverified';

export type ArchitectureRelationDirection = 'unidirectional' | 'bidirectional';

/** Severity ladder reused by consistency issues and impact analysis. */
export type ArchitectureIssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/* ------------------------------------------------------------------------- */
/* Source references — provenance / evidence                                 */
/* ------------------------------------------------------------------------- */

/** Where a piece of architectural knowledge was observed. */
export type ArchitectureSourceType =
  | 'project-description'
  | 'project-context'
  | 'agent-memory'
  | 'initial-capture'
  | 'global-context'
  | 'artifact-name'
  | 'artifact-objective'
  | 'artifact-key-concept'
  | 'artifact-content'
  | 'artifact-ir'
  | 'artifact-envelope'
  | 'artifact-compilation'
  | 'artifact-generation-trace'
  | 'manual';

/**
 * A traceable origin for an entity or relation. Every node and edge keeps the
 * list of source refs that produced it, so nothing in the graph is
 * unattributed — this is the evidence trail.
 */
export interface ArchitectureSourceRef {
  sourceType: ArchitectureSourceType;
  /** Stable id of the source surface (artifact id, `project:<id>`, …). */
  sourceId: string;
  /** Artifact id when the source is an artifact. */
  artifactId?: string;
  /** Artifact type when the source is an artifact. */
  artifactType?: ArtifactType;
  /** Optional section / heading id inside a document artifact. */
  sectionId?: string;
  /** Verbatim snippet that produced the signal (truncated). */
  excerpt?: string;
  /** Heuristic confidence of this single observation in [0..1]. */
  confidence: number;
  /** ISO timestamp of when the signal was extracted. */
  createdAt: string;
}

/* ------------------------------------------------------------------------- */
/* Entities & relations                                                      */
/* ------------------------------------------------------------------------- */

export interface ArchitectureEntity {
  /** Deterministic stable id: `ake-<type>-<slug(normalizedName)>`. */
  id: string;
  projectId: string;
  /** Canonical, human-readable name. */
  name: string;
  /** Accent-stripped, lowercased name used for deduplication. */
  normalizedName: string;
  type: ArchitectureEntityType;
  /** Optional finer classification (e.g. `rest` for an `api`). */
  subtype?: string;
  description?: string;
  /** Alternative spellings / acronyms merged into this entity. */
  aliases: string[];
  /** Every source that mentioned the entity (the evidence trail). */
  sourceRefs: ArchitectureSourceRef[];
  /** Consolidated confidence in [0..1]. */
  confidence: number;
  criticality: ArchitectureCriticality;
  status: ArchitectureEntityStatus;
  /** Free-form labels. */
  tags: string[];
  /** Structured, JSON-safe extension bag. */
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

export interface ArchitectureRelation {
  /** Deterministic stable id: `akr-<type>-<sourceId>__<targetId>`. */
  id: string;
  projectId: string;
  sourceEntityId: string;
  targetEntityId: string;
  type: ArchitectureRelationType;
  label?: string;
  description?: string;
  /** Integration protocol when relevant (e.g. `REST`, `gRPC`, `AMQP`). */
  protocol?: string;
  direction?: ArchitectureRelationDirection;
  sourceRefs: ArchitectureSourceRef[];
  confidence: number;
  metadata: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------------- */
/* Graph quality & statistics                                                */
/* ------------------------------------------------------------------------- */

export interface ArchitectureGraphStatistics {
  entityCount: number;
  relationCount: number;
  sourceArtifactCount: number;
  byEntityType: Partial<Record<ArchitectureEntityType, number>>;
  byRelationType: Partial<Record<ArchitectureRelationType, number>>;
  /** Entities flagged as low confidence (< 0.4). */
  lowConfidenceEntityCount: number;
  /** Entities flagged as possible duplicates. */
  candidateDuplicateCount: number;
  /** Entities with no relation attached. */
  orphanEntityCount: number;
}

export interface ArchitectureGraphQuality {
  /** Overall graph health score in [0..100]. */
  score: number;
  /** Average entity confidence in [0..1]. */
  averageConfidence: number;
  /** Share of artifacts that contributed at least one entity, in [0..1]. */
  artifactCoverage: number;
  /** Count of consistency issues at the last build, by severity. */
  consistencyIssueCount: number;
  traceabilityGapCount: number;
  summary: string;
}

/** The canonical, persistable Architecture Knowledge Graph. */
export interface ArchitectureGraph {
  projectId: string;
  /** Persisted schema version — see {@link ARCHITECTURE_GRAPH_SCHEMA_VERSION}. */
  version: number;
  /** Stable id for this build, so traces can correlate. */
  buildId: string;
  /** ISO timestamp of the last (re)build. */
  lastBuiltAt: string;
  /**
   * Deterministic content signature of the build inputs this graph was
   * produced from. Powers freshness detection (see
   * `ArchitectureGraphFreshness`): when the project's current signature
   * differs from this value the graph is `stale`. Optional and
   * backwards-compatible — graphs built before this field existed are
   * conservatively treated as stale.
   */
  sourceSignature?: string;
  entities: ArchitectureEntity[];
  relations: ArchitectureRelation[];
  quality: ArchitectureGraphQuality;
  statistics: ArchitectureGraphStatistics;
}

/* ------------------------------------------------------------------------- */
/* Build input                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Flat, decoupled input for the graph builder. The integration layer maps a
 * `Project` into this shape so the core services never depend on the app's
 * mutable domain model.
 */
export interface ArchitectureGraphBuildInput {
  projectId: string;
  projectName?: string;
  projectDescription?: string;
  projectContext?: string[];
  agentMemory?: string[];
  initialCapture?: string[];
  globalContext?: string[];
  /** Artifacts contributing knowledge. */
  artifacts?: ArchitectureGraphArtifactInput[];
  /** Override "now" — used by tests for deterministic timestamps. */
  now?: string;
  /** A previous graph, so manual edits / ids can be preserved across rebuilds. */
  previousGraph?: ArchitectureGraph;
}

/**
 * The minimal artifact projection the extractors need. Mirrors the relevant
 * fields of `Artifact` without forcing a hard dependency on the full type.
 */
export interface ArchitectureGraphArtifactInput {
  id: string;
  name: string;
  type: ArtifactType;
  objective?: string;
  representation?: 'diagram' | 'document' | 'hybrid';
  keyConcepts?: { term: string; definition: string }[];
  content?: string;
  /** Canonical diagram IR when present. */
  ir?: unknown;
  /** Normalized envelope snapshot. */
  artifactEnvelope?: unknown;
  /** Compilation summary. */
  compilation?: unknown;
  /** Generation trace. */
  generationTrace?: unknown;
  /** Per-artifact memory notes. */
  artifactMemory?: string[];
  updatedAt?: string;
}

/* ------------------------------------------------------------------------- */
/* Raw extraction output (pre-deduplication)                                 */
/* ------------------------------------------------------------------------- */

/** A single entity observation before consolidation. */
export interface RawEntitySignal {
  name: string;
  type: ArchitectureEntityType;
  subtype?: string;
  description?: string;
  aliases?: string[];
  criticality?: ArchitectureCriticality;
  tags?: string[];
  metadata?: Record<string, string | number | boolean>;
  source: ArchitectureSourceRef;
}

/** A single relation observation before consolidation. */
export interface RawRelationSignal {
  /** Normalized name of the source entity (resolved to an id later). */
  sourceName: string;
  sourceType?: ArchitectureEntityType;
  targetName: string;
  targetType?: ArchitectureEntityType;
  type: ArchitectureRelationType;
  label?: string;
  description?: string;
  protocol?: string;
  direction?: ArchitectureRelationDirection;
  source: ArchitectureSourceRef;
}

export interface RawExtractionResult {
  entities: RawEntitySignal[];
  relations: RawRelationSignal[];
}

/* ------------------------------------------------------------------------- */
/* Consistency engine                                                        */
/* ------------------------------------------------------------------------- */

export type ArchitectureConsistencyIssueType =
  | 'naming-divergence'
  | 'undocumented-external-system'
  | 'api-not-in-diagram'
  | 'data-entity-without-erd'
  | 'requirement-without-traceability'
  | 'nfr-without-metric'
  | 'risk-without-mitigation'
  | 'decision-without-impact'
  | 'component-without-container'
  | 'dangling-relation'
  | 'integration-without-protocol'
  | 'event-without-producer-or-consumer'
  | 'test-without-requirement'
  | 'user-story-without-acceptance'
  | 'ambiguous-glossary-term'
  | 'contradicting-artifacts'
  | 'duplicate-entities'
  | 'low-graph-coverage';

export interface ArchitectureConsistencyIssue {
  id: string;
  severity: ArchitectureIssueSeverity;
  type: ArchitectureConsistencyIssueType;
  message: string;
  recommendation: string;
  affectedArtifactIds: string[];
  affectedEntityIds: string[];
  affectedRelationIds: string[];
  autoFixable: boolean;
  /** Confidence that this is a real issue, in [0..1]. */
  confidence: number;
}

export interface ArchitectureConsistencyReport {
  projectId: string;
  generatedAt: string;
  issues: ArchitectureConsistencyIssue[];
  countsBySeverity: Record<ArchitectureIssueSeverity, number>;
  /** Quick verdict for gating: `blocked` when any critical issue is present. */
  verdict: 'clean' | 'warning' | 'blocked';
}

/* ------------------------------------------------------------------------- */
/* Traceability engine                                                       */
/* ------------------------------------------------------------------------- */

export type ArchitectureTraceabilityGapType =
  | 'requirement-without-test'
  | 'requirement-without-artifact'
  | 'nfr-without-quality-attribute'
  | 'risk-without-mitigation'
  | 'decision-without-impacted-entity'
  | 'data-entity-without-store'
  | 'event-without-consumer'
  | 'use-case-without-actor';

export interface ArchitectureTraceabilityGap {
  id: string;
  type: ArchitectureTraceabilityGapType;
  severity: ArchitectureIssueSeverity;
  entityId: string;
  entityName: string;
  message: string;
  recommendation: string;
}

/** A resolved bidirectional traceability link between two entities. */
export interface ArchitectureTraceabilityLink {
  fromEntityId: string;
  toEntityId: string;
  relationId: string;
  relationType: ArchitectureRelationType;
}

export interface ArchitectureTraceabilityReport {
  projectId: string;
  generatedAt: string;
  gaps: ArchitectureTraceabilityGap[];
  /** Share of requirements with at least one downstream link, in [0..1]. */
  requirementCoverage: number;
  /** Share of risks with a mitigation, in [0..1]. */
  riskCoverage: number;
  /** Total traceable links discovered. */
  linkCount: number;
}

/* ------------------------------------------------------------------------- */
/* Impact analysis                                                           */
/* ------------------------------------------------------------------------- */

export type ArchitectureImpactTargetKind = 'entity' | 'relation' | 'artifact';

export interface ArchitectureImpactRequest {
  kind: ArchitectureImpactTargetKind;
  /** Entity id, relation id or artifact id depending on `kind`. */
  targetId: string;
  /** How far to walk the dependency graph (default 2). */
  maxDepth?: number;
}

export interface ArchitectureImpactedArtifact {
  artifactId: string;
  artifactType?: ArtifactType;
  reason: string;
  severity: ArchitectureIssueSeverity;
}

export interface ArchitectureImpactResult {
  request: ArchitectureImpactRequest;
  generatedAt: string;
  /** Whether the target could be resolved against the graph. */
  resolved: boolean;
  impactedArtifactIds: string[];
  impactedArtifacts: ArchitectureImpactedArtifact[];
  relatedEntityIds: string[];
  relatedRelationIds: string[];
  severity: ArchitectureIssueSeverity;
  reasons: string[];
  recommendations: string[];
  /** Whether at least one downstream artifact should be regenerated. */
  requiresArtifactRegeneration: boolean;
  /** Whether a human should review the change before it ships. */
  requiresHumanReview: boolean;
}

/* ------------------------------------------------------------------------- */
/* Prompt context builder                                                    */
/* ------------------------------------------------------------------------- */

export interface ArchitectureGraphPromptContextOptions {
  artifactType?: ArtifactType;
  audience?: 'technical' | 'executive' | 'operations' | 'mixed';
  /** Free-text intent that focuses entity selection. */
  intent?: string;
  maxEntities?: number;
  maxRelations?: number;
  /** Soft character budget for the rendered markdown. */
  maxChars?: number;
  includeRisks?: boolean;
  includeDecisions?: boolean;
  includeNFRs?: boolean;
  includeDataEntities?: boolean;
  includeIntegrationEntities?: boolean;
  includeTraceabilityGaps?: boolean;
  language?: 'es' | 'en';
}

export interface ArchitectureGraphPromptContext {
  projectId: string;
  generatedAt: string;
  /** Markdown block ready to append to a generation prompt. */
  markdown: string;
  /** Entity ids that were included, for traceability. */
  includedEntityIds: string[];
  includedRelationIds: string[];
  approximateChars: number;
  /** True when the graph had no usable knowledge. */
  empty: boolean;
}

/* ------------------------------------------------------------------------- */
/* Quality bridge — compiler integration                                     */
/* ------------------------------------------------------------------------- */

/**
 * Per-artifact graph insight, surfaced by `ArchitectureGraphQualityBridge` and
 * consumed by the artifact compiler / inspector UI.
 */
export interface ArchitectureArtifactGraphInsight {
  artifactId: string;
  /** Entities the artifact contributed to the graph. */
  detectedEntityIds: string[];
  /** Relations the artifact contributed to the graph. */
  detectedRelationIds: string[];
  /** Coverage of the graph by this artifact, in [0..100]. */
  coverageScore: number;
  /** Consistency issues that reference this artifact. */
  consistencyIssues: ArchitectureConsistencyIssue[];
  /** Traceability gaps that reference entities owned by this artifact. */
  traceabilityGaps: ArchitectureTraceabilityGap[];
  recommendation: string;
  /** True when the compiler should warn about graph alignment. */
  shouldWarn: boolean;
  /** True when the compiler should block on graph grounds (critical issue). */
  shouldBlock: boolean;
}

/* ------------------------------------------------------------------------- */
/* Runtime validation                                                        */
/* ------------------------------------------------------------------------- */

export interface ArchitectureGraphValidationIssue {
  path: string;
  message: string;
}

export interface ArchitectureGraphValidationResult {
  /** Sanitized graph (corrupt entities/relations dropped) or `null`. */
  value: ArchitectureGraph | null;
  issues: ArchitectureGraphValidationIssue[];
}

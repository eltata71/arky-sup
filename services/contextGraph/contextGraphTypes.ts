/**
 * Architecture Context Graph — canonical contracts.
 *
 * The context graph is a deterministic, structured view of "what we know about
 * this project". It is extracted from `Project.description`,
 * `Project.projectContext`, `Project.agentMemory`, `Project.initialCapture`,
 * `Settings.globalContext`, `Artifact.artifactMemory`, the existing artifacts
 * and the on-demand `ArtifactRequestContext`.
 *
 * The goal is to stop feeding the model raw accumulated text and instead feed
 * a typed model of entities, relationships, signals, sources, conflicts,
 * freshness and relevance — so generation becomes precise, traceable and
 * explainable.
 *
 * Everything in this module is plain JSON-safe data: no `Date`, no `Map`, no
 * class instances. That keeps the graph trivially serializable for a future
 * Firestore persistence (see `contextGraphSerializer`).
 */

import type { ArchitecturalView, ArtifactRequestContext, ArtifactType, MemoryScope } from '../../types';
import type { Artifact } from '../../lib/artifacts';

/** Bump when the persisted shape changes in a non-backwards-compatible way. */
export const CONTEXT_GRAPH_SCHEMA_VERSION = 1;

/* ------------------------------------------------------------------------- */
/* Entity & relationship taxonomies                                          */
/* ------------------------------------------------------------------------- */

/** Minimum canonical entity taxonomy for the architecture context graph. */
export type ContextEntityType =
  | 'actor'
  | 'user-role'
  | 'business-capability'
  | 'system'
  | 'application'
  | 'external-platform'
  | 'integration'
  | 'api'
  | 'data-entity'
  | 'data-store'
  | 'process'
  | 'workflow'
  | 'risk'
  | 'decision'
  | 'constraint'
  | 'assumption'
  | 'requirement'
  | 'non-functional-requirement'
  | 'technology'
  | 'vendor'
  | 'country'
  | 'compliance-regulation';

/** Minimum canonical relationship taxonomy. */
export type ContextRelationshipType =
  | 'depends-on'
  | 'integrates-with'
  | 'owns'
  | 'consumes'
  | 'produces'
  | 'stores'
  | 'exposes'
  | 'calls'
  | 'mitigates'
  | 'constrains'
  | 'satisfies'
  | 'conflicts-with'
  | 'derived-from'
  | 'related-to';

/** Whether a piece of context was stated verbatim or inferred by heuristics. */
export type ContextExtractionMode = 'explicit' | 'inferred';

/* ------------------------------------------------------------------------- */
/* Sources                                                                   */
/* ------------------------------------------------------------------------- */

/** Where a signal originated. Mirrors the existing context surfaces. */
export type ContextSourceType =
  | 'project-description'
  | 'project-context'
  | 'agent-memory'
  | 'initial-capture'
  | 'global-context'
  | 'artifact-memory'
  | 'artifact-content'
  | 'artifact-name'
  | 'artifact-objective'
  | 'artifact-key-concept'
  | 'request-context';

/**
 * A traceable origin for a signal. Every entity and relationship keeps the
 * list of sources that produced it, so nothing in the graph is unattributed.
 */
export interface ContextSource {
  /** Stable id within the graph. */
  id: string;
  type: ContextSourceType;
  /** Memory scope this source maps to, when relevant. */
  scope?: MemoryScope;
  /** Human label so callers can render a citation list. */
  label: string;
  /** Artifact identifier when the source is an artifact. */
  artifactId?: string;
  /** Verbatim snippet that produced the signal (truncated). */
  snippet?: string;
  /** ISO timestamp of when the signal was extracted. */
  extractedAt: string;
  /** ISO timestamp of when the underlying source was last updated, when known. */
  updatedAt?: string;
}

/* ------------------------------------------------------------------------- */
/* Signals                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * A raw observation extracted from a single source before it is consolidated
 * into an entity or relationship. Signals are the audit trail of extraction.
 */
export interface ContextSignal {
  id: string;
  kind: 'entity' | 'relationship';
  /** Raw matched text. */
  text: string;
  /** Normalized label used for deduplication. */
  label: string;
  /** Classified entity type when `kind === 'entity'`. */
  entityType?: ContextEntityType;
  /** Classified relationship type when `kind === 'relationship'`. */
  relationshipType?: ContextRelationshipType;
  /** Endpoints when `kind === 'relationship'`. */
  fromLabel?: string;
  toLabel?: string;
  mode: ContextExtractionMode;
  /** Heuristic confidence in [0..1]. */
  confidence: number;
  source: ContextSource;
  extractedAt: string;
  tags: string[];
}

/* ------------------------------------------------------------------------- */
/* Freshness                                                                 */
/* ------------------------------------------------------------------------- */

/** Freshness verdict for an entity or relationship. */
export interface ContextFreshness {
  /** ISO date of the most recent contributing source. */
  lastSeenAt?: string;
  /** ISO date of the oldest contributing source. */
  firstSeenAt?: string;
  /** Age in days of the most recent contributing source. */
  ageDays?: number;
  /** Flagged as possibly outdated. */
  stale: boolean;
  /** Threshold (days) used to decide staleness. */
  staleAfterDays: number;
}

/* ------------------------------------------------------------------------- */
/* Entities & relationships                                                  */
/* ------------------------------------------------------------------------- */

export interface ContextEntity {
  /** Stable id: `${type}:${slug(label)}`. */
  id: string;
  type: ContextEntityType;
  /** Canonical, human-readable label. */
  label: string;
  /** Alternative spellings / acronyms merged into this entity. */
  aliases: string[];
  /** Optional disambiguating detail. */
  description?: string;
  mode: ContextExtractionMode;
  /** Consolidated confidence in [0..1]. */
  confidence: number;
  /** Every source that mentioned the entity. */
  sources: ContextSource[];
  /** Ids of the signals that produced the entity. */
  signalIds: string[];
  freshness: ContextFreshness;
  tags: string[];
}

export interface ContextRelationship {
  /** Stable id: `${type}:${fromId}->${toId}`. */
  id: string;
  type: ContextRelationshipType;
  fromId: string;
  toId: string;
  /** Optional human label for the edge. */
  label?: string;
  mode: ContextExtractionMode;
  confidence: number;
  sources: ContextSource[];
  freshness: ContextFreshness;
}

/* ------------------------------------------------------------------------- */
/* Conflicts                                                                 */
/* ------------------------------------------------------------------------- */

export type ContextConflictKind =
  | 'contradiction'
  | 'competing-choice'
  | 'reversal';

export interface ContextConflict {
  id: string;
  kind: ContextConflictKind;
  /** Human description of the contradiction. */
  description: string;
  /** Entities involved in the conflict. */
  entityIds: string[];
  /** Sources that contradict each other. */
  sources: ContextSource[];
  severity: 'low' | 'medium' | 'high';
  detectedAt: string;
}

/* ------------------------------------------------------------------------- */
/* The graph                                                                 */
/* ------------------------------------------------------------------------- */

export interface ContextGraphStats {
  entityCount: number;
  relationshipCount: number;
  signalCount: number;
  conflictCount: number;
  /** Entities flagged stale by the freshness evaluator. */
  staleCount: number;
  /** Entities created by inference rather than explicit mention. */
  inferredEntityCount: number;
  byEntityType: Partial<Record<ContextEntityType, number>>;
}

/** The canonical Architecture Context Graph. */
export interface ArchitectureContextGraph {
  projectId: string;
  projectName?: string;
  generatedAt: string;
  schemaVersion: number;
  sources: ContextSource[];
  signals: ContextSignal[];
  entities: ContextEntity[];
  relationships: ContextRelationship[];
  conflicts: ContextConflict[];
  stats: ContextGraphStats;
}

/* ------------------------------------------------------------------------- */
/* Graph construction input                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Flat, decoupled input for the graph builder. The integration layer maps a
 * `Project` + `Settings` into this shape so the core services never depend on
 * the app's mutable domain model.
 */
export interface ContextGraphInput {
  projectId: string;
  projectName?: string;
  projectDescription?: string;
  projectContext?: string[];
  agentMemory?: string[];
  initialCapture?: string[];
  globalContext?: string[];
  artifacts?: Artifact[];
  /** On-demand artifact request context, when a generation is in flight. */
  requestContext?: ArtifactRequestContext;
  /** Override "now" — used by tests and the freshness evaluator. */
  now?: string;
  /** Days after which a signal is considered stale. */
  staleAfterDays?: number;
}

/* ------------------------------------------------------------------------- */
/* Ranking, citations & packs                                                */
/* ------------------------------------------------------------------------- */

export type ContextDetailLevel = 'minimal' | 'standard' | 'rich';

/** Query that shapes which slice of the graph an AI generation receives. */
export interface ContextPackQuery {
  artifactType?: ArtifactType;
  audience?: 'technical' | 'executive' | 'operations' | 'mixed';
  /** Free-text intent (the on-demand request, or the artifact objective). */
  intent?: string;
  architecturalView?: ArchitecturalView;
  phase?: string;
  language?: 'es' | 'en';
  detailLevel?: ContextDetailLevel;
  /** Artifact ids whose entities should be boosted as "related work". */
  relatedArtifactIds?: string[];
  /** Soft character budget for the rendered markdown. */
  maxChars?: number;
  /** Maximum number of entities to keep after ranking. */
  topK?: number;
  /** Stale-after threshold forwarded to the freshness evaluator. */
  staleAfterDays?: number;
}

/** An entity scored against a `ContextPackQuery`. */
export interface RankedContextEntity extends ContextEntity {
  /** Final relevance score after ranking in [0..1]. */
  relevance: number;
}

/** A ranked entity enriched with its citation tag, ready for a pack. */
export interface ContextPackEntity extends RankedContextEntity {
  citation: string;
}

/** A stable, human-readable citation for a context entity. */
export interface ContextCitation {
  /** Tag injected into prompts, e.g. `[ctx:tech-1]`. */
  tag: string;
  entityId: string;
  label: string;
  entityType: ContextEntityType;
  sources: ContextSource[];
}

/** A signal excluded from a pack, kept for traceability. */
export interface IgnoredContextSignal {
  entityId: string;
  label: string;
  entityType: ContextEntityType;
  relevance: number;
  reason: string;
}

/**
 * A compact, ranked, citable slice of the graph tailored to one generation.
 * This is what an AI call receives instead of raw accumulated text.
 */
export interface ContextPack {
  id: string;
  projectId: string;
  generatedAt: string;
  query: ContextPackQuery;
  /** All entities included after ranking + budget enforcement. */
  entities: ContextPackEntity[];
  /** Relationships preserved between the included entities. */
  relationships: ContextRelationship[];
  /** Convenience slices (subsets of `entities`). */
  constraints: ContextPackEntity[];
  risks: ContextPackEntity[];
  decisions: ContextPackEntity[];
  dataEntities: ContextPackEntity[];
  integrations: ContextPackEntity[];
  citations: ContextCitation[];
  conflicts: ContextConflict[];
  /** Signals dropped by low relevance, kept so traceability is honest. */
  ignoredSignals: IgnoredContextSignal[];
  freshness: {
    newestAt?: string;
    oldestAt?: string;
    staleCount: number;
  };
  /** Markdown rendering, ready to inject into a prompt. */
  markdown: string;
  approximateChars: number;
}

/* ------------------------------------------------------------------------- */
/* Traceability                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Explains which context an artifact generation actually used. Built from a
 * `ContextPack` so every generated artifact can answer "what did you rely on?".
 */
export interface ContextUsageReport {
  packId: string;
  projectId: string;
  artifactId?: string;
  generatedAt: string;
  usedEntities: Array<{ id: string; label: string; type: ContextEntityType; citation: string; relevance: number }>;
  usedRelationships: Array<{ id: string; type: ContextRelationshipType; fromLabel: string; toLabel: string }>;
  usedDecisions: Array<{ id: string; label: string }>;
  consideredRisks: Array<{ id: string; label: string }>;
  appliedConstraints: Array<{ id: string; label: string }>;
  usedDataEntities: Array<{ id: string; label: string }>;
  usedIntegrations: Array<{ id: string; label: string }>;
  ignoredSignals: IgnoredContextSignal[];
  conflicts: ContextConflict[];
  staleSignals: Array<{ id: string; label: string; ageDays?: number }>;
  sources: ContextSource[];
}

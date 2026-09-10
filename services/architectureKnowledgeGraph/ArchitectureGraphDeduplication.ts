/**
 * Consolidation & deduplication for the Architecture Knowledge Graph (Task 5).
 *
 * Raw entity / relation signals are noisy by design — the same system may be
 * mentioned in five artifacts under three spellings. This module merges
 * equivalent signals **carefully**:
 *  - it never deletes evidence (every `sourceRef` is preserved);
 *  - it merges only on an exact normalized-name match with a compatible type;
 *  - similar-but-distinct names ("API Gateway" vs "BFF Gateway") are kept
 *    apart and flagged as `candidate-duplicate` instead of being fused;
 *  - entities with thin evidence are marked low-confidence / `unverified`.
 */

import type {
  ArchitectureCriticality,
  ArchitectureEntity,
  ArchitectureEntityType,
  ArchitectureGraph,
  ArchitectureRelation,
  ArchitectureSourceRef,
  RawEntitySignal,
  RawRelationSignal,
} from './ArchitectureKnowledgeGraphTypes';
import {
  areEntityTypesCompatible,
  buildEntityId,
  buildRelationId,
  clampConfidence,
  isSameEntityName,
  normalizeName,
  pickMoreSpecificType,
  tokenSimilarity,
} from './ArchitectureGraphNormalization';

const LOW_CONFIDENCE_THRESHOLD = 0.4;
const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;

const HIGH_CRITICALITY_TYPES: ReadonlySet<ArchitectureEntityType> = new Set([
  'risk',
  'securityControl',
]);

const criticalityRank: Record<ArchitectureCriticality, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

const maxCriticality = (
  a: ArchitectureCriticality,
  b: ArchitectureCriticality,
): ArchitectureCriticality => (criticalityRank[a] >= criticalityRank[b] ? a : b);

/** A working cluster of raw signals that resolve to a single entity. */
interface EntityCluster {
  type: ArchitectureEntityType;
  signals: RawEntitySignal[];
}

/** Picks the most human-friendly display name from a set of variants. */
const pickDisplayName = (names: string[]): string => {
  const sorted = [...names].sort((a, b) => {
    const aCaps = (a.match(/[A-ZÁÉÍÓÚÑ]/g) ?? []).length;
    const bCaps = (b.match(/[A-ZÁÉÍÓÚÑ]/g) ?? []).length;
    if (aCaps !== bCaps) return bCaps - aCaps;
    return a.length - b.length;
  });
  return sorted[0];
};

/** Computes a consolidated confidence from a set of evidence refs. */
const computeConfidence = (refs: ArchitectureSourceRef[]): number => {
  if (refs.length === 0) return 0;
  const maxRef = Math.max(...refs.map((ref) => ref.confidence));
  const breadth = Math.min(1, refs.length / 3);
  return clampConfidence(maxRef * 0.62 + breadth * 0.38);
};

/**
 * Consolidates raw entity signals into deduplicated entities. Stable ids and
 * `createdAt` timestamps are preserved across rebuilds via `previousGraph`.
 */
export const consolidateEntities = (
  signals: RawEntitySignal[],
  projectId: string,
  now: string,
  previousGraph?: ArchitectureGraph,
): ArchitectureEntity[] => {
  const byName = new Map<string, EntityCluster[]>();

  for (const signal of signals) {
    const normalized = normalizeName(signal.name);
    if (!normalized) continue;
    const clusters = byName.get(normalized) ?? [];
    let cluster = clusters.find((candidate) => areEntityTypesCompatible(candidate.type, signal.type));
    if (!cluster) {
      cluster = { type: signal.type, signals: [] };
      clusters.push(cluster);
    } else {
      cluster.type = pickMoreSpecificType(cluster.type, signal.type);
    }
    cluster.signals.push(signal);
    byName.set(normalized, clusters);
  }

  const previousById = new Map<string, ArchitectureEntity>(
    (previousGraph?.entities ?? []).map((entity) => [entity.id, entity]),
  );

  const entities: ArchitectureEntity[] = [];
  byName.forEach((clusters, normalized) => {
    for (const cluster of clusters) {
      const id = buildEntityId(cluster.type, normalized);
      const refs = cluster.signals.map((signal) => signal.source);
      const displayName = pickDisplayName(cluster.signals.map((signal) => signal.name));
      const aliases = Array.from(
        new Set(
          cluster.signals
            .map((signal) => signal.name.trim())
            .filter((name) => name && name !== displayName),
        ),
      );
      const description = cluster.signals.find((signal) => signal.description)?.description;
      const tags = Array.from(new Set(cluster.signals.flatMap((signal) => signal.tags ?? [])));
      const subtype = cluster.signals.find((signal) => signal.subtype)?.subtype;
      const metadata: Record<string, string | number | boolean> = {};
      for (const signal of cluster.signals) {
        Object.assign(metadata, signal.metadata ?? {});
      }
      let criticality: ArchitectureCriticality = HIGH_CRITICALITY_TYPES.has(cluster.type)
        ? 'high'
        : 'medium';
      for (const signal of cluster.signals) {
        if (signal.criticality) criticality = maxCriticality(criticality, signal.criticality);
      }
      const confidence = computeConfidence(refs);
      const previous = previousById.get(id);
      const status: ArchitectureEntity['status'] =
        confidence < LOW_CONFIDENCE_THRESHOLD ? 'unverified' : 'active';

      entities.push({
        id,
        projectId,
        name: displayName,
        normalizedName: normalized,
        type: cluster.type,
        subtype,
        description,
        aliases,
        sourceRefs: refs,
        confidence,
        criticality,
        status,
        tags,
        metadata,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      });
    }
  });

  flagCandidateDuplicates(entities);
  return entities.sort((a, b) => b.confidence - a.confidence);
};

/**
 * Marks pairs of distinct entities that look suspiciously alike. They are not
 * merged — only flagged — so the architect (or the consistency engine) can
 * decide. Marking is non-destructive: it only touches `status`/`tags`.
 */
const flagCandidateDuplicates = (entities: ArchitectureEntity[]): void => {
  for (let i = 0; i < entities.length; i += 1) {
    for (let j = i + 1; j < entities.length; j += 1) {
      const a = entities[i];
      const b = entities[j];
      if (a.id === b.id) continue;
      if (!areEntityTypesCompatible(a.type, b.type)) continue;
      if (isSameEntityName(a.name, b.name)) continue;
      const similarity = tokenSimilarity(a.name, b.name);
      if (similarity < DUPLICATE_SIMILARITY_THRESHOLD) continue;
      for (const [entity, other] of [
        [a, b],
        [b, a],
      ] as const) {
        if (entity.status === 'active' || entity.status === 'proposed') {
          entity.status = 'candidate-duplicate';
        }
        const tag = `candidate-duplicate-of:${other.id}`;
        if (!entity.tags.includes(tag)) entity.tags.push(tag);
      }
    }
  }
};

/**
 * Resolves raw relation signals against the consolidated entities. Endpoints
 * that cannot be resolved produce a synthetic `unknown` entity tagged
 * `unresolved-reference`, so the graph is never internally dangling — the
 * consistency engine surfaces those as `dangling-relation` issues.
 */
export const consolidateRelations = (
  signals: RawRelationSignal[],
  entities: ArchitectureEntity[],
  projectId: string,
  now: string,
  previousGraph?: ArchitectureGraph,
): { relations: ArchitectureRelation[]; entities: ArchitectureEntity[] } => {
  const workingEntities = [...entities];
  const nameIndex = new Map<string, ArchitectureEntity>();
  for (const entity of workingEntities) {
    if (!nameIndex.has(entity.normalizedName)) nameIndex.set(entity.normalizedName, entity);
    for (const alias of entity.aliases) {
      const normalizedAlias = normalizeName(alias);
      if (normalizedAlias && !nameIndex.has(normalizedAlias)) nameIndex.set(normalizedAlias, entity);
    }
  }

  const synthesize = (rawName: string): ArchitectureEntity => {
    const normalized = normalizeName(rawName) || 'referencia';
    const id = buildEntityId('unknown', normalized);
    const existing = nameIndex.get(normalized);
    if (existing) return existing;
    const synthetic: ArchitectureEntity = {
      id,
      projectId,
      name: rawName.trim() || 'Referencia sin resolver',
      normalizedName: normalized,
      type: 'unknown',
      aliases: [],
      sourceRefs: [],
      confidence: 0.2,
      criticality: 'low',
      status: 'unverified',
      tags: ['unresolved-reference'],
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    workingEntities.push(synthetic);
    nameIndex.set(normalized, synthetic);
    return synthetic;
  };

  const previousById = new Map<string, ArchitectureRelation>(
    (previousGraph?.relations ?? []).map((relation) => [relation.id, relation]),
  );
  const relationById = new Map<string, ArchitectureRelation>();

  for (const signal of signals) {
    const sourceEntity = nameIndex.get(normalizeName(signal.sourceName)) ?? synthesize(signal.sourceName);
    const targetEntity = nameIndex.get(normalizeName(signal.targetName)) ?? synthesize(signal.targetName);
    if (sourceEntity.id === targetEntity.id) continue;
    const id = buildRelationId(signal.type, sourceEntity.id, targetEntity.id);
    const existing = relationById.get(id);
    if (existing) {
      existing.sourceRefs.push(signal.source);
      existing.confidence = clampConfidence(Math.max(existing.confidence, signal.source.confidence));
      if (!existing.protocol && signal.protocol) existing.protocol = signal.protocol;
      if (!existing.label && signal.label) existing.label = signal.label;
      continue;
    }
    const previous = previousById.get(id);
    relationById.set(id, {
      id,
      projectId,
      sourceEntityId: sourceEntity.id,
      targetEntityId: targetEntity.id,
      type: signal.type,
      label: signal.label,
      description: signal.description,
      protocol: signal.protocol,
      direction: signal.direction,
      sourceRefs: [signal.source],
      confidence: clampConfidence(signal.source.confidence),
      metadata: {},
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
  }

  return {
    relations: Array.from(relationById.values()).sort((a, b) => b.confidence - a.confidence),
    entities: workingEntities,
  };
};

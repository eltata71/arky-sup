/**
 * ContextGraphBuilder — orchestrates the deterministic pipeline that turns a
 * `ContextGraphInput` into an `ArchitectureContextGraph`:
 *
 *   extract signals → dedupe into entities → derive relationships →
 *   detect conflicts → compute stats.
 *
 * Relationships are produced two ways:
 *  - explicit: when one source mentions a relationship verb cue alongside two
 *    entities (`mode: 'explicit'`),
 *  - inferred: type-based edges anchored on the project's root system
 *    (`mode: 'inferred'`, lower confidence) — these never invent new entities.
 */

import {
  CONTEXT_GRAPH_SCHEMA_VERSION,
  type ArchitectureContextGraph,
  type ContextEntity,
  type ContextEntityType,
  type ContextGraphInput,
  type ContextGraphStats,
  type ContextRelationship,
  type ContextRelationshipType,
  type ContextSignal,
} from './contextGraphTypes';
import { contextSignalExtractor, normalizeLabel } from './contextSignalExtractor';
import { contextDeduplicator } from './contextDeduplicator';
import { contextConflictDetector } from './contextConflictDetector';
import { contextFreshnessEvaluator } from './contextFreshnessEvaluator';

interface VerbCue {
  keywords: string[];
  type: ContextRelationshipType;
}

const RELATIONSHIP_VERB_CUES: VerbCue[] = [
  { keywords: ['integra con', 'se integra', 'integracion con', 'conecta con', 'interfaz con'], type: 'integrates-with' },
  { keywords: ['depende de', 'depende del', 'requiere de'], type: 'depends-on' },
  { keywords: ['almacena en', 'guarda en', 'persiste en', 'persiste los'], type: 'stores' },
  { keywords: ['consume el', 'consume la', 'consume datos', 'consume informacion'], type: 'consumes' },
  { keywords: ['produce', 'genera el', 'genera la', 'publica el', 'publica eventos'], type: 'produces' },
  { keywords: ['expone'], type: 'exposes' },
  { keywords: ['llama a', 'invoca a', 'invoca el'], type: 'calls' },
  { keywords: ['mitiga'], type: 'mitigates' },
];

/** Inferred edge from a non-root entity towards the project's root system. */
interface InferredEdgeRule {
  /** Edge runs from the entity to the root system. */
  fromEntity: boolean;
  type: ContextRelationshipType;
}

const INFERRED_EDGE_RULES: Partial<Record<ContextEntityType, InferredEdgeRule>> = {
  actor: { fromEntity: true, type: 'consumes' },
  'user-role': { fromEntity: true, type: 'consumes' },
  integration: { fromEntity: true, type: 'integrates-with' },
  'external-platform': { fromEntity: true, type: 'integrates-with' },
  api: { fromEntity: false, type: 'exposes' },
  application: { fromEntity: false, type: 'owns' },
  'data-store': { fromEntity: false, type: 'owns' },
  'data-entity': { fromEntity: false, type: 'stores' },
  process: { fromEntity: false, type: 'owns' },
  workflow: { fromEntity: false, type: 'owns' },
  'business-capability': { fromEntity: false, type: 'owns' },
  technology: { fromEntity: false, type: 'depends-on' },
  vendor: { fromEntity: false, type: 'depends-on' },
  'compliance-regulation': { fromEntity: true, type: 'constrains' },
  constraint: { fromEntity: true, type: 'constrains' },
  requirement: { fromEntity: false, type: 'satisfies' },
  'non-functional-requirement': { fromEntity: false, type: 'satisfies' },
  risk: { fromEntity: true, type: 'related-to' },
  decision: { fromEntity: true, type: 'related-to' },
  assumption: { fromEntity: true, type: 'related-to' },
};

const emptyStats = (): ContextGraphStats => ({
  entityCount: 0,
  relationshipCount: 0,
  signalCount: 0,
  conflictCount: 0,
  staleCount: 0,
  inferredEntityCount: 0,
  byEntityType: {},
});

export class ContextGraphBuilder {
  build(input: ContextGraphInput): ArchitectureContextGraph {
    const now = input.now ?? new Date().toISOString();
    const freshnessOpts = { now, staleAfterDays: input.staleAfterDays };

    const { signals, sources } = contextSignalExtractor.extract({ ...input, now });
    const entities = contextDeduplicator.dedupe(signals, freshnessOpts);

    // Map every signal id back to its consolidated entity.
    const signalIdToEntity = new Map<string, ContextEntity>();
    for (const entity of entities) {
      for (const signalId of entity.signalIds) signalIdToEntity.set(signalId, entity);
    }

    const relationshipSignals: ContextSignal[] = [];
    const relationships = this.buildRelationships(
      signals,
      entities,
      signalIdToEntity,
      now,
      input.staleAfterDays,
      relationshipSignals,
    );

    const conflicts = contextConflictDetector.detect(entities, now);

    const allSignals = [...signals, ...relationshipSignals];
    const stats = this.computeStats(entities, relationships, allSignals, conflicts.length);

    return {
      projectId: input.projectId,
      projectName: input.projectName,
      generatedAt: now,
      schemaVersion: CONTEXT_GRAPH_SCHEMA_VERSION,
      sources,
      signals: allSignals,
      entities,
      relationships,
      conflicts,
      stats,
    };
  }

  private buildRelationships(
    signals: ContextSignal[],
    entities: ContextEntity[],
    signalIdToEntity: Map<string, ContextEntity>,
    now: string,
    staleAfterDays: number | undefined,
    relationshipSignals: ContextSignal[],
  ): ContextRelationship[] {
    const byId = new Map<string, ContextRelationship>();
    let relSeq = 0;

    const add = (rel: ContextRelationship): void => {
      const existing = byId.get(rel.id);
      if (!existing) {
        byId.set(rel.id, rel);
        return;
      }
      // Explicit always wins over inferred; otherwise keep the stronger one.
      if (existing.mode === 'inferred' && rel.mode === 'explicit') {
        byId.set(rel.id, rel);
      } else if (rel.confidence > existing.confidence) {
        byId.set(rel.id, { ...existing, confidence: rel.confidence });
      }
    };

    // --- Explicit relationships from verb cues co-occurring with entities. ---
    const orderedBySource = new Map<string, ContextEntity[]>();
    for (const signal of signals) {
      const entity = signalIdToEntity.get(signal.id);
      if (!entity) continue;
      const list = orderedBySource.get(signal.source.id) ?? [];
      if (!list.some((e) => e.id === entity.id)) list.push(entity);
      orderedBySource.set(signal.source.id, list);
    }

    for (const [sourceId, sourceEntities] of orderedBySource) {
      if (sourceEntities.length < 2) continue;
      const source = sourceEntities[0].sources.find((s) => s.id === sourceId);
      if (!source) continue;
      const haystack = normalizeLabel(source.snippet ?? '');
      const cue = RELATIONSHIP_VERB_CUES.find((c) =>
        c.keywords.some((kw) => haystack.includes(kw)),
      );
      if (!cue) continue;
      const [from, to] = sourceEntities;
      const id = `${cue.type}:${from.id}=>${to.id}`;
      const freshness = contextFreshnessEvaluator.evaluate([source], { now, staleAfterDays });
      add({
        id,
        type: cue.type,
        fromId: from.id,
        toId: to.id,
        label: source.snippet ? truncateLabel(source.snippet) : undefined,
        mode: 'explicit',
        confidence: 0.65,
        sources: [source],
        freshness,
      });
      relationshipSignals.push({
        id: `relsig-${++relSeq}`,
        kind: 'relationship',
        text: source.snippet ?? `${from.label} ${cue.type} ${to.label}`,
        label: `${from.label} → ${to.label}`,
        relationshipType: cue.type,
        fromLabel: from.label,
        toLabel: to.label,
        mode: 'explicit',
        confidence: 0.65,
        source,
        extractedAt: now,
        tags: ['relationship'],
      });
    }

    // --- Inferred, type-based edges anchored on the root system. ------------
    const root =
      entities.find((e) => e.type === 'system' && e.tags.includes('root-system')) ??
      entities.find((e) => e.type === 'system');
    if (root) {
      for (const entity of entities) {
        if (entity.id === root.id) continue;
        const rule = INFERRED_EDGE_RULES[entity.type];
        if (!rule) continue;
        const fromId = rule.fromEntity ? entity.id : root.id;
        const toId = rule.fromEntity ? root.id : entity.id;
        add({
          id: `${rule.type}:${fromId}=>${toId}`,
          type: rule.type,
          fromId,
          toId,
          mode: 'inferred',
          confidence: 0.45,
          sources: entity.sources,
          freshness: entity.freshness,
        });
      }
    }

    return Array.from(byId.values());
  }

  private computeStats(
    entities: ContextEntity[],
    relationships: ContextRelationship[],
    signals: ContextSignal[],
    conflictCount: number,
  ): ContextGraphStats {
    const stats = emptyStats();
    stats.entityCount = entities.length;
    stats.relationshipCount = relationships.length;
    stats.signalCount = signals.length;
    stats.conflictCount = conflictCount;
    for (const entity of entities) {
      stats.byEntityType[entity.type] = (stats.byEntityType[entity.type] ?? 0) + 1;
      if (entity.freshness.stale) stats.staleCount += 1;
      if (entity.mode === 'inferred') stats.inferredEntityCount += 1;
    }
    return stats;
  }
}

const truncateLabel = (value: string): string => {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= 80 ? clean : `${clean.slice(0, 79)}…`;
};

export const contextGraphBuilder = new ContextGraphBuilder();

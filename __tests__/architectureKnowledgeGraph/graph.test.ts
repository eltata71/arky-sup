import { describe, expect, it } from 'vitest';
import {
  buildArchitectureKnowledgeGraph,
  consolidateEntities,
  consolidateRelations,
  createEmptyArchitectureGraph,
  type ArchitectureSourceRef,
  type RawEntitySignal,
  type RawRelationSignal,
} from '../../services/architectureKnowledgeGraph';
import { NOW, fullBuildInput } from './fixtures';

const ref = (sourceId: string): ArchitectureSourceRef => ({
  sourceType: 'artifact-content',
  sourceId,
  artifactId: sourceId,
  confidence: 0.8,
  createdAt: NOW,
});

describe('ArchitectureKnowledgeGraphService', () => {
  it('builds a valid empty graph for a project without knowledge', () => {
    const graph = buildArchitectureKnowledgeGraph({ projectId: 'empty', now: NOW });
    expect(graph.entities).toHaveLength(0);
    expect(graph.relations).toHaveLength(0);
    expect(graph.quality.score).toBe(0);
    expect(graph.statistics.entityCount).toBe(0);
    expect(graph.version).toBeGreaterThan(0);
  });

  it('createEmptyArchitectureGraph produces a structurally valid graph', () => {
    const graph = createEmptyArchitectureGraph('p', NOW);
    expect(graph.projectId).toBe('p');
    expect(graph.lastBuiltAt).toBe(NOW);
    expect(graph.statistics.byEntityType).toEqual({});
  });

  it('builds a populated graph from a multi-artifact project', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    expect(graph.entities.length).toBeGreaterThan(0);
    expect(graph.relations.length).toBeGreaterThan(0);
    expect(graph.statistics.entityCount).toBe(graph.entities.length);
    expect(graph.statistics.sourceArtifactCount).toBeGreaterThan(0);
    // The C4 diagram contributed structural entities.
    expect(graph.entities.some((e) => e.type === 'system')).toBe(true);
    expect(graph.entities.some((e) => e.type === 'externalSystem')).toBe(true);
    // The build is deterministic.
    const second = buildArchitectureKnowledgeGraph(fullBuildInput);
    expect(second.entities.map((e) => e.id).sort()).toEqual(graph.entities.map((e) => e.id).sort());
  });

  it('never throws on a corrupt artifact input', () => {
    expect(() =>
      buildArchitectureKnowledgeGraph({
        projectId: 'p',
        now: NOW,
        artifacts: [
          // Intentionally malformed `ir` / `content`.
          { id: 'bad', name: 'Roto', type: 'markdown', ir: 'not-an-object', content: undefined } as never,
        ],
      }),
    ).not.toThrow();
  });
});

describe('ArchitectureGraph deduplication', () => {
  it('merges signals with the same normalized name into one entity', () => {
    const signals: RawEntitySignal[] = [
      { name: 'API Gateway', type: 'api', source: ref('a1') },
      { name: 'api gateway', type: 'api', source: ref('a2') },
    ];
    const entities = consolidateEntities(signals, 'p', NOW);
    expect(entities).toHaveLength(1);
    expect(entities[0].sourceRefs).toHaveLength(2);
    expect(entities[0].aliases.length).toBeGreaterThan(0);
  });

  it('preserves every sourceRef when merging (no evidence lost)', () => {
    const signals: RawEntitySignal[] = [
      { name: 'Pagos', type: 'businessProcess', source: ref('a1') },
      { name: 'Pagos', type: 'businessProcess', source: ref('a2') },
      { name: 'Pagos', type: 'businessProcess', source: ref('a3') },
    ];
    const entities = consolidateEntities(signals, 'p', NOW);
    expect(entities).toHaveLength(1);
    expect(entities[0].sourceRefs.map((r) => r.sourceId).sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('flags similar-but-distinct entities as candidate duplicates instead of merging', () => {
    const signals: RawEntitySignal[] = [
      { name: 'Servicio Pagos', type: 'system', source: ref('a1') },
      { name: 'Servicio de Pagos', type: 'system', source: ref('a2') },
    ];
    const entities = consolidateEntities(signals, 'p', NOW);
    expect(entities).toHaveLength(2);
    expect(entities.every((e) => e.status === 'candidate-duplicate')).toBe(true);
  });

  it('synthesizes placeholder entities for unresolved relation endpoints', () => {
    const relationSignals: RawRelationSignal[] = [
      { sourceName: 'Servicio A', targetName: 'Servicio Fantasma', type: 'calls', source: ref('a1') },
    ];
    const baseEntities = consolidateEntities(
      [{ name: 'Servicio A', type: 'system', source: ref('a1') }],
      'p',
      NOW,
    );
    const { relations, entities } = consolidateRelations(relationSignals, baseEntities, 'p', NOW);
    expect(relations).toHaveLength(1);
    expect(entities.some((e) => e.tags.includes('unresolved-reference'))).toBe(true);
  });
});

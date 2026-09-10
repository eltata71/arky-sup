import { describe, expect, it } from 'vitest';
import { contextGraphBuilder, contextGraphSerializer } from '../../services/contextGraph';
import { makeArtifact } from './fixtures';

const NOW = '2026-05-16T00:00:00.000Z';

describe('ContextGraphBuilder', () => {
  it('deduplicates an entity mentioned by several sources', () => {
    const graph = contextGraphBuilder.build({
      projectId: 'p1',
      projectName: 'Plataforma',
      projectDescription: 'Backend en PostgreSQL.',
      projectContext: ['La persistencia transaccional vive en PostgreSQL.'],
      now: NOW,
    });

    const postgres = graph.entities.filter((e) => e.label === 'PostgreSQL');
    expect(postgres).toHaveLength(1);
    expect(postgres[0].sources.length).toBeGreaterThanOrEqual(2);
  });

  it('merges divergent spellings as aliases', () => {
    const graph = contextGraphBuilder.build({
      projectId: 'p1',
      projectContext: ['Desplegamos en Kubernetes.'],
      agentMemory: ['La operación corre sobre k8s.'],
      now: NOW,
    });

    const kube = graph.entities.find((e) => e.label === 'Kubernetes');
    expect(kube).toBeDefined();
    expect(kube!.aliases).toContain('k8s');
  });

  it('detects competing primary databases as a conflict', () => {
    const graph = contextGraphBuilder.build({
      projectId: 'p1',
      projectName: 'Plataforma',
      projectContext: ['La base de datos principal es PostgreSQL.'],
      agentMemory: ['Ahora movemos los datos a MongoDB.'],
      now: NOW,
    });

    expect(graph.conflicts.some((c) => c.kind === 'competing-choice')).toBe(true);
    expect(graph.stats.conflictCount).toBe(graph.conflicts.length);
  });

  it('flags context coming from old artifacts as stale', () => {
    const oldArtifact = makeArtifact({
      id: 'old-art',
      createdAt: '2019-01-01T00:00:00.000Z',
      name: 'Diagrama heredado',
      content: 'El motor de búsqueda usa Elasticsearch.',
    });
    const graph = contextGraphBuilder.build({
      projectId: 'p1',
      projectName: 'Plataforma',
      artifacts: [oldArtifact],
      now: NOW,
      staleAfterDays: 120,
    });

    const elastic = graph.entities.find((e) => e.label === 'Elasticsearch');
    expect(elastic).toBeDefined();
    expect(elastic!.freshness.stale).toBe(true);
    expect(graph.stats.staleCount).toBeGreaterThanOrEqual(1);
  });

  it('derives inferred and explicit relationships', () => {
    const graph = contextGraphBuilder.build({
      projectId: 'p1',
      projectName: 'Plataforma de Pagos',
      projectDescription: 'Construida sobre Node.js.',
      projectContext: ['El backend se integra con Stripe para procesar pagos.'],
      now: NOW,
    });

    // Inferred: the root system depends on the detected technology.
    expect(graph.relationships.some((r) => r.type === 'depends-on' && r.mode === 'inferred')).toBe(true);
    // Explicit: the "se integra con" cue yields an explicit relationship.
    expect(graph.relationships.some((r) => r.mode === 'explicit')).toBe(true);
    expect(graph.signals.some((s) => s.kind === 'relationship')).toBe(true);
  });

  it('produces consistent stats', () => {
    const graph = contextGraphBuilder.build({
      projectId: 'p1',
      projectName: 'Plataforma',
      projectDescription: 'Backend en PostgreSQL y AWS.',
      now: NOW,
    });
    expect(graph.stats.entityCount).toBe(graph.entities.length);
    expect(graph.stats.relationshipCount).toBe(graph.relationships.length);
    expect(graph.stats.signalCount).toBe(graph.signals.length);
    expect(graph.schemaVersion).toBeGreaterThanOrEqual(1);
  });

  it('serializes and deserializes a graph without data loss', () => {
    const graph = contextGraphBuilder.build({
      projectId: 'p1',
      projectName: 'Plataforma',
      projectDescription: 'Backend en PostgreSQL, mensajería con Apache Kafka.',
      now: NOW,
    });
    const json = contextGraphSerializer.serialize(graph);
    const restored = contextGraphSerializer.deserialize(json);

    expect(restored.entities.length).toBe(graph.entities.length);
    expect(restored.projectId).toBe(graph.projectId);
    expect(restored.stats.entityCount).toBe(graph.stats.entityCount);
  });

  it('rejects malformed graphs on deserialize', () => {
    expect(() => contextGraphSerializer.deserialize('{"projectId":"p1"}')).toThrow();
    expect(() => contextGraphSerializer.deserialize('not json')).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import {
  createSupabaseKnowledgeGraphRepository,
  type SupabaseKnowledgeGraphClientLike,
} from '../../../services/architectureKnowledgeGraph';
import type { ArchitectureGraph } from '../../../services/architectureKnowledgeGraph';

const graph = (): ArchitectureGraph => ({
  projectId: 'proj_legacy_001',
  version: 1,
  buildId: 'build_001',
  lastBuiltAt: '2026-09-12T00:00:00.000Z',
  entities: [],
  relations: [],
  quality: { score: 80, averageConfidence: 0.9, artifactCoverage: 1, consistencyIssueCount: 0, traceabilityGapCount: 0, summary: 'OK' },
  statistics: { entityCount: 0, relationCount: 0, sourceArtifactCount: 0, byEntityType: {}, byRelationType: {}, lowConfidenceEntityCount: 0, candidateDuplicateCount: 0, orphanEntityCount: 0 },
});

interface FakeClient extends SupabaseKnowledgeGraphClientLike {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }>;
}

function fakeClient(options: { data?: unknown; error?: unknown } = {}): FakeClient {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: options.data ?? null, error: options.error ?? null };
    },
    calls,
  } as FakeClient;
}

describe('SupabaseKnowledgeGraphRepository', () => {
  it('la revisión viaja con el grafo, no en el repositorio (F5-05)', async () => {
    const client = fakeClient({ data: { ...graph(), revision: 5 } });
    const repository = createSupabaseKnowledgeGraphRepository(client);
    const loaded = await repository.load('proj_legacy_001');
    expect(loaded?.buildId).toBe('build_001');
    expect(loaded?.revision).toBe(5);

    // Otra instancia —como la de escrituras frente a la de lecturas— guarda con
    // la revisión que trae el grafo. Con el `Map` de antes enviaba 0.
    const other = createSupabaseKnowledgeGraphRepository(client);
    await other.save(loaded!);
    expect(client.calls[1].args.p_expected_revision).toBe(5);
    expect(client.calls[1].args.p_project_id).toBe('proj_legacy_001');
    expect(client.calls[1].args.p_graph).not.toHaveProperty('revision');
  });

  it('un grafo sin revisión es nuevo y se guarda contra 0, y devuelve la confirmada', async () => {
    const client = fakeClient({ data: { revision: 1 } });
    const result = await createSupabaseKnowledgeGraphRepository(client).save(graph());
    expect(client.calls[0].args.p_expected_revision).toBe(0);
    expect(result.data?.revision).toBe(1);
  });

  it('trata P0002 como ausencia: devuelve null para reconstruir, no falla', async () => {
    const client = fakeClient({ error: { code: 'P0002', message: 'El grafo no existe' } });
    const repository = createSupabaseKnowledgeGraphRepository(client);
    const result = await repository.load('proj_legacy_001');
    expect(result).toBeNull();
  });

  it('reporta conflicto P0001 como revisión obsoleta', async () => {
    const client = fakeClient({ error: { code: 'P0001', message: 'Conflicto de grafo' } });
    const repository = createSupabaseKnowledgeGraphRepository(client);
    const result = await repository.save(graph());
    expect(result.success).toBe(false);
    expect(result.status).toBe('conflict');
  });

  it('reporta permiso 42501 como permission-denied', async () => {
    const client = fakeClient({ error: { code: '42501', message: 'Permiso insuficiente: project:write' } });
    const repository = createSupabaseKnowledgeGraphRepository(client);
    const result = await repository.save(graph());
    expect(result.success).toBe(false);
    expect(result.status).toBe('permission-denied');
  });

  it('lista los pendientes de la bitácora (F5-04)', async () => {
    const client = fakeClient({ data: [
      { projectId: 'p1', projection: 'knowledge-graph', generation: 3, processedGeneration: 1, requestedAt: '2026-09-24T00:00:00Z', attempts: 2, lastError: 'red' },
      { projectId: 'p2', projection: 'otra-cosa', generation: 1 },
    ] });
    const pending = await createSupabaseKnowledgeGraphRepository(client).listPendingProjections();
    expect(pending).toEqual([{ projectId: 'p1', generation: 3, requestedAt: '2026-09-24T00:00:00Z', attempts: 2, lastError: 'red' }]);
  });

  it('una base sin la bitácora devuelve null, no un error', async () => {
    const client = fakeClient({ error: { code: 'PGRST202', message: 'Could not find the function' } });
    expect(await createSupabaseKnowledgeGraphRepository(client).listPendingProjections()).toBeNull();
  });

  it('guarda la proyección con su generación y lee el resultado', async () => {
    const client = fakeClient({ data: { applied: false, reason: 'stale', generation: 4, processedGeneration: 4, pending: false } });
    const result = await createSupabaseKnowledgeGraphRepository(client).saveProjection({ ...graph(), revision: 9 }, 2);
    expect(client.calls[0]).toMatchObject({ name: 'save_graph_projection', args: { p_project_id: 'proj_legacy_001', p_generation: 2 } });
    expect(client.calls[0].args.p_graph).not.toHaveProperty('revision');
    expect(result.data).toEqual({ applied: false, reason: 'stale', revision: undefined, pending: false });
  });
});

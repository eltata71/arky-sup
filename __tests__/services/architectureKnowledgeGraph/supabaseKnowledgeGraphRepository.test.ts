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
  it('carga el grafo propio y fija la revisión observada', async () => {
    const client = fakeClient({ data: { ...graph(), revision: 5 } });
    const repository = createSupabaseKnowledgeGraphRepository(client);
    const result = await repository.load('proj_legacy_001');
    expect(result?.buildId).toBe('build_001');
    await repository.save(graph());
    expect(client.calls[1].args.p_expected_revision).toBe(5);
    expect(client.calls[1].args.p_project_id).toBe('proj_legacy_001');
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
});
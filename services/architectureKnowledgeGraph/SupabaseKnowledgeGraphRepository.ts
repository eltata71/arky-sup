import type { ArchitectureGraph } from '../architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';
import { deserializeArchitectureGraph } from '../architectureKnowledgeGraph/ArchitectureGraphPersistenceAdapter';
import { createOperationId, type PersistenceResult } from '../persistence';

/** Superficie mínima de PostgREST para el grafo; sin SDK en el dominio. */
export interface SupabaseKnowledgeGraphClientLike {
  rpc(name: 'load_knowledge_graph', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'save_knowledge_graph', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export interface SupabaseKnowledgeGraphRepository {
  load(projectId: string): Promise<ArchitectureGraph | null>;
  save(graph: ArchitectureGraph, expectedRevision?: number): Promise<PersistenceResult<void>>;
}

const statusFor = (error: unknown): 'conflict' | 'permission-denied' | 'offline' | 'validation-error' | 'failed' => {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : '';
  if (code === 'P0001' || code === '23505') return 'conflict';
  if (code === '42501' || code === 'PGRST301') return 'permission-denied';
  if (code === '22023' || code === '23514') return 'validation-error';
  if (code === 'fetch' || code === 'ECONNABORTED' || /failed to fetch|networkerror/i.test(message)
    || (typeof navigator !== 'undefined' && !navigator.onLine)) return 'offline';
  return 'failed';
};

const failed = <T>(
  operationId: string,
  error: unknown,
  message: string,
): PersistenceResult<T> => ({
  status: statusFor(error),
  success: false,
  operationId,
  target: 'supabase',
  error,
  errorCode: error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined,
  message,
});

/**
 * Repositorio Supabase del grafo de conocimiento arquitectónico.
 *
 * Un proyecto tiene exactamente un grafo y es derivado: una lectura ausente no
 * es un error del adaptador, es la señal de que el llamante debe reconstruirlo.
 * La entrada pasa por migración + validación de runtime, igual que Firestore.
 */
export function createSupabaseKnowledgeGraphRepository(
  client: SupabaseKnowledgeGraphClientLike,
): SupabaseKnowledgeGraphRepository {
  const revisions = new Map<string, number>();

  return {
    async load(projectId) {
      const { data, error } = await client.rpc('load_knowledge_graph', { p_project_id: projectId });
      if (error) {
        const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
        if (code === 'P0002') return null; // ausente → reconstruir, no fallar
        throw error;
      }
      const graph = deserializeArchitectureGraph(data);
      if (graph) revisions.set(projectId, Number((data as { revision?: unknown }).revision ?? 0));
      return graph;
    },

    async save(graph, expectedRevision = revisions.get(graph.projectId) ?? 0) {
      const operationId = createOperationId('saveKnowledgeGraph');
      const { error } = await client.rpc('save_knowledge_graph', {
        p_project_id: graph.projectId,
        p_graph: graph,
        p_expected_revision: expectedRevision,
      });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar el grafo en Supabase.');
      revisions.set(graph.projectId, expectedRevision + 1);
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },
  };
}
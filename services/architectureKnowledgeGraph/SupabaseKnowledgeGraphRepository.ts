import type { ArchitectureGraph } from '../architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';
import { deserializeArchitectureGraph } from '../architectureKnowledgeGraph/ArchitectureGraphPersistenceAdapter';
import { createOperationId, type PersistenceResult } from '../persistence';

/** Superficie mínima de PostgREST para el grafo; sin SDK en el dominio. */
export interface SupabaseKnowledgeGraphClientLike {
  rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

/** Un pendiente de la bitácora de proyecciones (F5-04), tal como lo lista la base. */
export interface PendingGraphProjection {
  projectId: string;
  generation: number;
  requestedAt: string;
  attempts: number;
  lastError: string | null;
}

/** Lo que responde la base al guardar una proyección con su generación. */
export interface GraphProjectionOutcome {
  /** `false` cuando la generación ya estaba procesada o era anterior. */
  applied: boolean;
  reason?: 'already-processed' | 'stale';
  /** Revisión confirmada del grafo, cuando se escribió. */
  revision?: number;
  /** Queda trabajo posterior en la bitácora. */
  pending: boolean;
}

export interface SupabaseKnowledgeGraphRepository {
  load(projectId: string): Promise<ArchitectureGraph | null>;
  /**
   * Guarda el grafo contra la revisión que **trae el propio grafo** (0 si es
   * nuevo) y devuelve la confirmada. Hasta F5-05 la revisión vivía en un `Map`
   * privado de cada instancia, y lecturas y escrituras usaban instancias
   * distintas: tras recargar, toda reconstrucción de un grafo existente se
   * enviaba con revisión 0 y la base la rechazaba sin que nadie lo viera.
   */
  save(graph: ArchitectureGraph): Promise<PersistenceResult<{ revision: number }>>;
  /** Los pendientes del usuario. `null` si la bitácora no existe todavía. */
  listPendingProjections(): Promise<PendingGraphProjection[] | null>;
  /** Guarda el grafo y marca su generación en una transacción. */
  saveProjection(graph: ArchitectureGraph, generation: number): Promise<PersistenceResult<GraphProjectionOutcome>>;
  /** Anota un intento fallido, sin tocar el grafo. */
  failProjection(projectId: string, generation: number, error: string): Promise<void>;
}

/** El documento que se guarda: la revisión es de la base, no del documento. */
const toStoredGraph = (graph: ArchitectureGraph): Omit<ArchitectureGraph, 'revision'> => {
  const { revision: _revision, ...stored } = graph;
  return stored;
};

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : Number(value ?? fallback) || fallback;

/**
 * Una RPC que PostgREST no conoce: la migración de F5-04 todavía no está
 * aplicada en esta base. No es un fallo de la operación sino de la versión del
 * esquema, y quien llama degrada al comportamiento anterior.
 */
export const isMissingRpc = (error: unknown): boolean => {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return code === 'PGRST202' || code === '404' || code === 404;
};

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
  return {
    async load(projectId) {
      const { data, error } = await client.rpc('load_knowledge_graph', { p_project_id: projectId });
      if (error) {
        const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
        if (code === 'P0002') return null; // ausente → reconstruir, no fallar
        throw error;
      }
      const graph = deserializeArchitectureGraph(data);
      if (!graph) return null;
      return { ...graph, revision: numberOr((data as { revision?: unknown }).revision, 0) };
    },

    async save(graph) {
      const operationId = createOperationId('saveKnowledgeGraph');
      const { data, error } = await client.rpc('save_knowledge_graph', {
        p_project_id: graph.projectId,
        p_graph: toStoredGraph(graph),
        p_expected_revision: graph.revision ?? 0,
      });
      if (error) return failed(operationId, error, 'No se pudo confirmar el grafo en Supabase.');
      const revision = numberOr((data as { revision?: unknown } | null)?.revision, (graph.revision ?? 0) + 1);
      return { status: 'success', success: true, operationId, target: 'supabase', data: { revision } };
    },

    async listPendingProjections() {
      const { data, error } = await client.rpc('list_pending_projections', {});
      if (error) {
        if (isMissingRpc(error)) return null;
        throw error;
      }
      return (Array.isArray(data) ? data : [])
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
        .filter((row) => row.projection === 'knowledge-graph' && typeof row.projectId === 'string')
        .map((row) => ({
          projectId: row.projectId as string,
          generation: numberOr(row.generation, 0),
          requestedAt: typeof row.requestedAt === 'string' ? row.requestedAt : '',
          attempts: numberOr(row.attempts, 0),
          lastError: typeof row.lastError === 'string' ? row.lastError : null,
        }));
    },

    async saveProjection(graph, generation) {
      const operationId = createOperationId('saveGraphProjection');
      const { data, error } = await client.rpc('save_graph_projection', {
        p_project_id: graph.projectId,
        p_graph: toStoredGraph(graph),
        p_generation: generation,
      });
      if (error) return failed(operationId, error, 'No se pudo confirmar la proyección del grafo.');
      const row = (data ?? {}) as Record<string, unknown>;
      const reason = row.reason === 'already-processed' || row.reason === 'stale' ? row.reason : undefined;
      return {
        status: 'success',
        success: true,
        operationId,
        target: 'supabase',
        data: {
          applied: row.applied === true,
          reason,
          revision: typeof row.revision === 'number' ? row.revision : undefined,
          pending: row.pending === true,
        },
      };
    },

    async failProjection(projectId, generation, message) {
      // Anotar un fallo es observabilidad, no la operación: si no llega, el
      // pendiente sigue ahí y el próximo intento lo vuelve a encontrar.
      await client.rpc('fail_projection', {
        p_project_id: projectId,
        p_generation: generation,
        p_error: message.slice(0, 500),
      });
    },
  };
}

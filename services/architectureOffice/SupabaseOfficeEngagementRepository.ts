import type { OfficeArbDecision, OfficeEngagement } from '../architectureOffice/OfficeTypes';
import { normalizeEngagement } from '../architectureOffice/OfficeEngagementRepository';
import { createOperationId, type PersistenceResult } from '../persistence';

/** Superficie mínima de PostgREST para el agregado; sin SDK en el dominio. */
export interface SupabaseOfficeClientLike {
  rpc(name: 'load_engagements', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'save_engagement', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'delete_engagement', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'record_arb_decision', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

interface RemoteEngagementRecord {
  readonly engagement: OfficeEngagement;
  readonly revision: number;
}

export interface SupabaseOfficeEngagementRepository {
  list(projectId: string): Promise<OfficeEngagement[]>;
  save(
    engagement: OfficeEngagement,
    expectedRevision?: number,
  ): Promise<PersistenceResult<void>>;
  remove(projectId: string, engagementId: string): Promise<PersistenceResult<void>>;
  recordArbDecision(
    engagement: OfficeEngagement,
    decision: OfficeArbDecision,
  ): Promise<PersistenceResult<void>>;
}

const asRemoteRecord = (value: unknown, projectId: string): RemoteEngagementRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as { data?: unknown; revision?: unknown };
  if (!Number.isInteger(row.revision) || (row.revision as number) < 1) return null;
  const engagement = normalizeEngagement(row.data, projectId);
  return engagement ? { engagement, revision: row.revision as number } : null;
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
 * Repositorio Supabase de Encargos de Oficina.
 *
 * `list` hidrata la RPC `api.load_engagements`, que trae cada encargo con su
 * espejo de decisiones ARB; las decisiones reales viven en el registro
 * inmutable, así que el espejo que porta el documento se reemplaza al leer.
 */
export function createSupabaseOfficeEngagementRepository(
  client: SupabaseOfficeClientLike,
): SupabaseOfficeEngagementRepository {
  const revisions = new Map<string, number>();

  return {
    async list(projectId) {
      const { data, error } = await client.rpc('load_engagements', { p_project_id: projectId });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('La respuesta remota de encargos no es una lista.');
      const records = data.map((row) => asRemoteRecord(row, projectId));
      if (records.some((record) => record === null)) {
        throw new Error('La respuesta remota de encargos contiene una fila inválida.');
      }
      const valid = records as RemoteEngagementRecord[];
      for (const record of valid) revisions.set(record.engagement.id, record.revision);
      return valid.map((record) => record.engagement);
    },

    async save(engagement, expectedRevision = revisions.get(engagement.id) ?? 0) {
      const operationId = createOperationId('saveEngagement');
      const { data, error } = await client.rpc('save_engagement', {
        p_project_id: engagement.projectId,
        p_engagement: engagement,
        p_expected_revision: expectedRevision,
      });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar el encargo en Supabase.');
      const record = asRemoteRecord(data, engagement.projectId);
      if (!record) {
        return {
          status: 'failed', success: false, operationId, target: 'supabase',
          message: 'Supabase confirmó una respuesta de encargo inválida.',
        };
      }
      revisions.set(record.engagement.id, record.revision);
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },

    async remove(projectId, engagementId, expectedRevision = revisions.get(engagementId) ?? 0) {
      const operationId = createOperationId('deleteEngagement');
      const { error } = await client.rpc('delete_engagement', {
        p_project_id: projectId,
        p_engagement_id: engagementId,
        p_expected_revision: expectedRevision,
      });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar el borrado del encargo en Supabase.');
      revisions.delete(engagementId);
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },

    async recordArbDecision(engagement, decision) {
      const operationId = createOperationId('recordArbDecision');
      const { error } = await client.rpc('record_arb_decision', { p_decision: decision });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar la decisión del ARB en Supabase.');
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },
  };
}
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
  /**
   * Devuelve el encargo **tal y como quedó guardado**, con su revisión nueva.
   *
   * Devolvía `void`, y eso obligaba a quien llamaba a quedarse con el objeto
   * que había enviado — cuya revisión ya es la anterior. La siguiente escritura
   * partía de un testigo caducado y el servidor la rechazaba, o —peor, y es lo
   * que pasaba— el repositorio se lo había apuntado en un mapa global y la
   * dejaba pasar.
   */
  save(engagement: OfficeEngagement): Promise<PersistenceResult<OfficeEngagement>>;
  remove(
    projectId: string,
    engagementId: string,
    expectedRevision: number,
  ): Promise<PersistenceResult<void>>;
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
 * El documento que viaja a la RPC, sin el testigo de fila.
 *
 * `revision` es una columna, no un campo del documento. Copiarlo dentro del
 * JSON sería una segunda verdad sobre el mismo hecho, y además una que nace
 * obsoleta: la fila la incrementa el `insert … on conflict do update`, así que
 * la copia de dentro quedaría siempre una por detrás.
 */
const asDocument = (engagement: OfficeEngagement): Omit<OfficeEngagement, 'revision'> => {
  const { revision: _storedRevision, ...document } = engagement;
  return document;
};

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
      // La revisión se pega al agregado que vuelve, no a un mapa por id. Ver la
      // nota de `OfficeEngagement.revision`: un mapa compartido acaba diciendo
      // la revisión de la última lectura, no la del snapshot que se edita.
      return valid.map((record) => ({ ...record.engagement, revision: record.revision }));
    },

    async save(engagement) {
      const operationId = createOperationId('saveEngagement');
      // Ausente es 0, y 0 significa «espero que la fila no exista». Un encargo
      // recién salido de la fábrica es exactamente eso; uno cuyo testigo se
      // perdió por el camino se estrella contra un conflicto en vez de pisar
      // una escritura ajena, que es la dirección correcta del fallo.
      const expectedRevision = engagement.revision ?? 0;
      const { data, error } = await client.rpc('save_engagement', {
        p_project_id: engagement.projectId,
        p_engagement: asDocument(engagement),
        p_expected_revision: expectedRevision,
      });
      if (error) {
        return failed<OfficeEngagement>(operationId, error, 'No se pudo confirmar el encargo en Supabase.');
      }
      const record = asRemoteRecord(data, engagement.projectId);
      if (!record) {
        return {
          status: 'failed', success: false, operationId, target: 'supabase',
          message: 'Supabase confirmó una respuesta de encargo inválida.',
        };
      }
      return {
        status: 'success',
        success: true,
        operationId,
        target: 'supabase',
        data: { ...record.engagement, revision: record.revision },
      };
    },

    async remove(projectId, engagementId, expectedRevision) {
      const operationId = createOperationId('deleteEngagement');
      const { error } = await client.rpc('delete_engagement', {
        p_project_id: projectId,
        p_engagement_id: engagementId,
        p_expected_revision: expectedRevision,
      });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar el borrado del encargo en Supabase.');
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
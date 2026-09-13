import type { BusinessInitiative } from './BusinessInitiativeTypes';
import { normalizeInitiative } from './BusinessInitiativeRepository';
import { createOperationId, type PersistenceResult } from '../persistence';

/** Superficie mínima de PostgREST para el agregado; sin SDK en el dominio. */
export interface SupabaseBusinessInitiativesClientLike {
  rpc(name: 'list_business_initiatives', args: Record<string, never>): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'save_business_initiative', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'delete_business_initiative', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

interface RemoteInitiativeRecord {
  readonly initiative: BusinessInitiative;
  readonly revision: number;
}

export interface SupabaseBusinessInitiativeRepository {
  list(userId: string): Promise<BusinessInitiative[]>;
  save(
    initiative: BusinessInitiative,
    userId: string,
    expectedRevision?: number,
  ): Promise<PersistenceResult<BusinessInitiative>>;
  remove(initiativeId: string, userId: string, expectedRevision?: number): Promise<PersistenceResult<void>>;
}

const asRemoteRecord = (value: unknown, fallbackUserId: string): RemoteInitiativeRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as { data?: unknown; revision?: unknown };
  if (!Number.isInteger(row.revision) || (row.revision as number) < 1) return null;
  const initiative = normalizeInitiative(row.data, fallbackUserId);
  return initiative ? { initiative, revision: row.revision as number } : null;
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
 * Repositorio Supabase de Iniciativas.
 *
 * `id` permanece `text`: los `init_*` existentes son claves que ya aparecen en
 * `Project.initiativeIds`. Convertirlos a UUID en este corte produciría enlaces
 * rotos antes de migrar proyectos, exactamente lo que F5 evita.
 */
export function createSupabaseBusinessInitiativeRepository(
  client: SupabaseBusinessInitiativesClientLike,
): SupabaseBusinessInitiativeRepository {
  const revisions = new Map<string, number>();

  return {
    async list(userId) {
      const { data, error } = await client.rpc('list_business_initiatives', {});
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('La respuesta remota de iniciativas no es una lista.');
      const records = data.map((row) => asRemoteRecord(row, userId));
      if (records.some((record) => record === null)) {
        throw new Error('La respuesta remota de iniciativas contiene una fila inválida.');
      }
      const valid = records as RemoteInitiativeRecord[];
      for (const record of valid) revisions.set(record.initiative.id, record.revision);
      return valid.map((record) => record.initiative);
    },

    async save(initiative, userId, expectedRevision = revisions.get(initiative.id) ?? 0) {
      const operationId = createOperationId('saveBusinessInitiative');
      if (initiative.userId !== userId) {
        return {
          status: 'validation-error', success: false, operationId, target: 'supabase',
          message: 'La iniciativa no pertenece a la sesión que intenta guardarla.',
        };
      }
      const { data, error } = await client.rpc('save_business_initiative', {
        p_initiative: initiative,
        p_expected_revision: expectedRevision,
      });
      if (error) return failed<BusinessInitiative>(operationId, error, 'No se pudo confirmar la iniciativa en Supabase.');
      const record = asRemoteRecord(data, userId);
      if (!record) {
        return {
          status: 'failed', success: false, operationId, target: 'supabase',
          message: 'Supabase confirmó una respuesta de iniciativa inválida.',
        };
      }
      revisions.set(record.initiative.id, record.revision);
      return { status: 'success', success: true, operationId, target: 'supabase', data: record.initiative };
    },

    async remove(initiativeId, userId, expectedRevision = revisions.get(initiativeId) ?? 0) {
      const operationId = createOperationId('deleteBusinessInitiative');
      const { error } = await client.rpc('delete_business_initiative', {
        p_id: initiativeId,
        p_expected_revision: expectedRevision,
      });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar el borrado de la iniciativa en Supabase.');
      revisions.delete(initiativeId);
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },
  };
}

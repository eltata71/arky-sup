import type { BusinessInitiative } from './BusinessInitiativeTypes';
import { normalizeInitiative } from './BusinessInitiativeRepository';
import { createOperationId, supabaseFailure, type PersistenceResult } from '../persistence';

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

/**
 * El fallo, clasificado por la **tabla compartida**.
 *
 * Este fichero llevaba su propia copia de `statusFor` y de `failed`, y era una
 * de las copias que `services/persistence/supabaseErrors.ts` existe para haber
 * retirado. No era orden: la copia local no conocía `23503`
 * —`foreign_key_violation`, el código con el que el servidor rechaza borrar
 * algo que otra fila cita— así que ese rechazo se clasificaba como `failed`
 * genérico en vez de `validation-error`. Y tampoco propagaba el mensaje del
 * servidor, que en ese caso es justo lo útil: nombra los registros que hay que
 * desvincular primero.
 */
const failed = <T>(
  operationId: string,
  error: unknown,
  message: string,
): PersistenceResult<T> => supabaseFailure<T>(operationId, error, message)

/**
 * El documento que viaja a la RPC, sin el testigo de fila.
 *
 * `revision` es una columna. Copiarlo dentro del JSON sería una segunda verdad
 * sobre el mismo hecho, y una que nace obsoleta: la fila la incrementa el
 * `on conflict do update`.
 */
const asDocument = (initiative: BusinessInitiative): Omit<BusinessInitiative, 'revision'> => {
  const { revision: _storedRevision, ...document } = initiative;
  return document;
};

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
      // La revisión se pega al agregado que vuelve, no a un mapa por id: un
      // mapa compartido acaba diciendo la revisión de la última lectura, no la
      // del snapshot que se está editando.
      return valid.map((record) => ({ ...record.initiative, revision: record.revision }));
    },

    async save(initiative, userId, expectedRevision = initiative.revision ?? 0) {
      const operationId = createOperationId('saveBusinessInitiative');
      if (initiative.userId !== userId) {
        return {
          status: 'validation-error', success: false, operationId, target: 'supabase',
          message: 'La iniciativa no pertenece a la sesión que intenta guardarla.',
        };
      }
      const { data, error } = await client.rpc('save_business_initiative', {
        // Sin el testigo: es una columna, no un campo del documento.
        p_initiative: asDocument(initiative),
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
      return {
        status: 'success', success: true, operationId, target: 'supabase',
        data: { ...record.initiative, revision: record.revision },
      };
    },

    async remove(initiativeId, userId, expectedRevision = 0) {
      const operationId = createOperationId('deleteBusinessInitiative');
      const { error } = await client.rpc('delete_business_initiative', {
        p_id: initiativeId,
        p_expected_revision: expectedRevision,
      });
      if (error) return failed<void>(operationId, error, 'No se pudo confirmar el borrado de la iniciativa en Supabase.');
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },
  };
}

import type { Settings } from '../../types';
import { createOperationId, type PersistenceResult } from '../persistence';

/** La mínima superficie de PostgREST que usa el piloto; el SDK queda fuera del dominio. */
export interface SupabaseSettingsClientLike {
  from(table: 'user_settings'): {
    select(columns: 'settings, revision'): {
      eq(column: 'id', value: string): {
        maybeSingle(): Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
  rpc(name: 'save_user_settings', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export interface RemoteSettingsRecord {
  readonly settings: Settings;
  readonly revision: number;
}

export interface SupabaseSettingsRepository {
  load(userId: string): Promise<Settings | null>;
  save(settings: Settings, userId: string, expectedRevision?: number): Promise<PersistenceResult<RemoteSettingsRecord>>;
}

/**
 * Las claves BYOK viven exclusivamente en localStorage. Aunque una llamada las
 * inyecte por fuera del tipo, no cruzan la frontera hacia PostgreSQL.
 */
export function sanitizeSettingsForRemote(settings: Settings): Settings {
  const clone = JSON.parse(JSON.stringify(settings)) as Settings & {
    aiConfig?: Record<string, unknown>;
  };
  if (clone.aiConfig) delete clone.aiConfig.apiKey;
  // La revisión es de la fila, no del documento (F6-03).
  delete (clone as Partial<Settings>).revision;
  return clone;
}

const asRecord = (value: unknown): RemoteSettingsRecord | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as { settings?: unknown; revision?: unknown };
  if (!row.settings || typeof row.settings !== 'object' || !Number.isInteger(row.revision)) return null;
  return { settings: row.settings as Settings, revision: row.revision as number };
};

const statusFor = (error: unknown): 'conflict' | 'permission-denied' | 'offline' | 'failed' => {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : '';
  if (code === 'P0001') return 'conflict';
  if (code === '42501' || code === 'PGRST301') return 'permission-denied';
  if (code === 'fetch' || code === 'ECONNABORTED' || /failed to fetch|networkerror/i.test(message)
    || (typeof navigator !== 'undefined' && !navigator.onLine)) return 'offline';
  return 'failed';
};

export function createSupabaseSettingsRepository(client: SupabaseSettingsClientLike): SupabaseSettingsRepository {
  // La revisión viaja en `Settings.revision` (F6-03), desde la lectura hasta el
  // estado de React y de vuelta; hasta aquí vivía en un `Map` de la instancia.
  return {
    async load(userId) {
      const { data, error } = await client.from('user_settings').select('settings, revision').eq('id', userId).maybeSingle();
      if (error) throw error;
      if (data === null) return null;
      const record = asRecord(data);
      if (!record) throw new Error('La respuesta de configuración remota no tiene la forma esperada.');
      return { ...record.settings, revision: record.revision };
    },

    async save(settings, _userId, expectedRevision = settings.revision ?? 0) {
      const operationId = createOperationId('saveUserSettings');
      const { data, error } = await client.rpc('save_user_settings', {
        p_settings: sanitizeSettingsForRemote(settings),
        p_expected_revision: expectedRevision,
      });
      if (error) {
        const status = statusFor(error);
        return {
          status,
          success: false,
          operationId,
          target: 'supabase',
          error,
          errorCode: error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : undefined,
          message: 'No se pudo confirmar la configuración en Supabase.',
        };
      }
      const record = asRecord(data);
      if (!record) {
        return {
          status: 'failed', success: false, operationId, target: 'supabase',
          message: 'Supabase confirmó una respuesta de configuración inválida.',
        };
      }
      return {
        status: 'success', success: true, operationId, target: 'supabase',
        data: { settings: { ...record.settings, revision: record.revision }, revision: record.revision },
      };
    },
  };
}

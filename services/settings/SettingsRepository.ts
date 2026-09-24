/**
 * Las preferencias de una persona: tema, idioma y configuración de IA.
 *
 * Una fila por usuario en `api.user_settings`, escrita por
 * `api.save_user_settings` con revisión optimista. La caché tiene un TTL de
 * media hora en vez de los cinco minutos por defecto porque unos ajustes
 * cambian cuando alguien los cambia, y releerlos cada cinco minutos era una
 * lectura por nada.
 *
 * **Sin sesión no hay preferencias remotas.** El documento `settings/global` de
 * Firestore existía para el caso «todavía no sé quién eres», y en PostgreSQL no
 * tiene equivalente: una fila sin propietario no la puede proteger ninguna
 * política. Sin `userId` se devuelve lo último que vio este navegador, que es la
 * misma degradación que el resto del producto usa y no una segunda fuente de
 * verdad.
 */

import type { Settings } from '../../types';
import { observabilityService } from '../observability';
import {
  SETTINGS_COLLECTION,
  classifyPersistenceError,
  createFailureResult,
  getErrorCode,
  isWriteConfirmed,
  readLocal,
  writeLocalDraft,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { MemoryCache } from '../../utils';
import { createSupabaseSettingsRepository } from './SupabaseSettingsRepository';
import { loadSupabaseDataClient } from '../adapters';

const SETTINGS_TTL_MS = 30 * 60 * 1000;

const cache = new MemoryCache();
const cacheKey = (userId?: string): string => `settings_${userId || 'global'}`;
const draftKeyFor = (userId?: string): string => (userId ? `${SETTINGS_COLLECTION}_${userId}` : SETTINGS_COLLECTION);

/**
 * La revisión que la base confirmó en una escritura, para que quien guarda la
 * devuelva a su estado (F6-03). `undefined` si la escritura no la trae: un
 * borrador local, o un fallo.
 */
export const confirmedSettingsRevision = (result: PersistenceResult<unknown>): number | undefined => {
  const revision = (result.data as { revision?: unknown } | undefined)?.revision;
  return typeof revision === 'number' ? revision : undefined;
};

export interface SettingsRepository {
  load(userId?: string): Promise<Settings | null>;
  save(settings: Settings, userId?: string): Promise<PersistenceResult<unknown>>;
  clearCache(): void;
}

let remote: ReturnType<typeof createSupabaseSettingsRepository> | null = null;
const getRemote = async () => {
  if (!remote) {
    const client = await loadSupabaseDataClient();
    remote = createSupabaseSettingsRepository(
      client as unknown as Parameters<typeof createSupabaseSettingsRepository>[0],
    );
  }
  return remote;
};

/** Solo para pruebas: olvida el repositorio remoto memorizado. */
export const resetSettingsRepositoryCache = (): void => {
  remote = null;
  cache.clear();
};

export const settingsRepository: SettingsRepository = {
  async load(userId) {
    const cached = cache.get<Settings>(cacheKey(userId), SETTINGS_TTL_MS);
    if (cached) return cached;
    if (!userId) return readLocal<Settings>(draftKeyFor(userId));
    try {
      const settings = await (await getRemote()).load(userId);
      if (settings) cache.set(cacheKey(userId), settings);
      return settings;
    } catch (error) {
      observabilityService.reportError(error, {
        source: 'operation',
        title: 'No se pudieron cargar las preferencias',
        message: 'La lectura de configuración falló. Se intentará el espejo local si existe.',
        operationName: 'loadUserSettings',
        recoverable: true,
        userVisible: true,
        metadata: { errorCode: getErrorCode(error), status: classifyPersistenceError(error) },
      });
      return readLocal<Settings>(draftKeyFor(userId));
    }
  },

  async save(settings, userId) {
    if (!userId) {
      return writeLocalDraft(draftKeyFor(userId), settings);
    }
    let result: PersistenceResult<unknown>;
    try {
      result = await (await getRemote()).save(settings, userId);
    } catch (error) {
      // `loadSupabaseDataClient` lanza cuando el despliegue no tiene
      // configuración. Se clasifica en vez de propagarse: quien llama a un
      // repositorio recibe siempre un sobre, nunca una excepción.
      result = createFailureResult('saveUserSettings', error);
    }
    if (isWriteConfirmed(result)) {
      cache.set(cacheKey(userId), { ...settings, revision: confirmedSettingsRevision(result) ?? settings.revision });
    }
    else if (result.status === 'offline') writeLocalDraft(draftKeyFor(userId), settings);
    return result;
  },

  clearCache() {
    cache.clear();
  },
};

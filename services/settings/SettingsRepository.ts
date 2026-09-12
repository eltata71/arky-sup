/**
 * Las preferencias de una persona: tema, idioma y configuración de IA.
 *
 * Un documento por usuario en `settings/user_{uid}`, más un `settings/global`
 * heredado para el caso sin sesión. La caché tiene un TTL de media hora en vez
 * de los cinco minutos por defecto porque unos ajustes cambian cuando alguien
 * los cambia, y releerlos cada cinco minutos era una lectura por nada.
 *
 * La degradación tiene una asimetría que conviene ver: la clave de la caché en
 * memoria (`settings_{uid}`) no es la del espejo local (`settings_{uid}` con el
 * nombre de la colección delante). Viene así de `firestoreService` y se
 * conserva — cambiarla dejaría huérfano el borrador de quien tenga uno pendiente
 * en su navegador ahora mismo.
 */

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db as firestore } from '../../firebase';
import type { Settings } from '../../types';
import { observabilityService } from '../observability';
import {
  GLOBAL_SETTINGS_DOC,
  SETTINGS_COLLECTION,
  classifyPersistenceError,
  executeRemoteWrite,
  getErrorCode,
  isWriteConfirmed,
  readLocal,
  writeLocalDraft,
  requireDb,
} from '../persistence';
import type { PersistenceResult } from '../persistence';
import { MemoryCache } from '../../utils';
import { createSupabaseSettingsRepository } from './SupabaseSettingsRepository';
import { loadSupabaseDataClient, resolveBackend } from '../adapters';

const SETTINGS_TTL_MS = 30 * 60 * 1000;

const cache = new MemoryCache();
const cacheKey = (userId?: string): string => `settings_${userId || 'global'}`;
const draftKeyFor = (userId?: string): string => (userId ? `${SETTINGS_COLLECTION}_${userId}` : SETTINGS_COLLECTION);
const docIdFor = (userId?: string): string => (userId ? `user_${userId}` : GLOBAL_SETTINGS_DOC);

export interface SettingsRepository {
  load(userId?: string): Promise<Settings | null>;
  save(settings: Settings, userId?: string): Promise<PersistenceResult<unknown>>;
  clearCache(): void;
}

export const firebaseSettingsRepository: SettingsRepository = {
  async load(userId) {
    const cached = cache.get<Settings>(cacheKey(userId), SETTINGS_TTL_MS);
    if (cached) return cached;
    try {
      const snap = await getDoc(doc(requireDb(firestore), SETTINGS_COLLECTION, docIdFor(userId)));
      if (!snap.exists()) return null;
      const settings = snap.data() as Settings;
      cache.set(cacheKey(userId), settings);
      return settings;
    } catch (error) {
      observabilityService.reportError(error, {
        source: 'operation',
        title: 'No se pudieron cargar settings',
        message: 'La lectura de settings falló. Se intentará caché local de lectura si existe.',
        operationName: 'getGlobalSettings',
        recoverable: true,
        userVisible: true,
        metadata: { errorCode: getErrorCode(error), status: classifyPersistenceError(error) },
      });
      return readLocal<Settings>(draftKeyFor(userId));
    }
  },

  async save(settings, userId) {
    const result = await executeRemoteWrite({ operationName: 'saveGlobalSettings', userId }, async () => {
      await setDoc(doc(requireDb(firestore), SETTINGS_COLLECTION, docIdFor(userId)), settings);
    });
    if (isWriteConfirmed(result)) cache.set(cacheKey(userId), settings);
    else if (result.status === 'offline') writeLocalDraft(draftKeyFor(userId), settings);
    return result;
  },

  clearCache() {
    cache.clear();
  },
};

/**
 * Corte F5: `settings` puede usar Supabase sin cambiar los demás contextos.
 *
 * Sin uid no hay fila con propietario, por lo que el documento global histórico
 * sigue en Firebase/local. No hay lectura dual para una sesión autenticada:
 * una vez activada la bandera, Supabase es la fuente única de este conjunto.
 */
const runtimeEnv = (): Record<string, string | undefined> => import.meta.env as Record<string, string | undefined>;

export const settingsRepository: SettingsRepository = {
  async load(userId) {
    const env = runtimeEnv();
    if (userId && resolveBackend(env, 'settings').backend === 'supabase') {
      try {
        const repository = createSupabaseSettingsRepository(
          await loadSupabaseDataClient(env) as unknown as Parameters<typeof createSupabaseSettingsRepository>[0],
        );
        return await repository.load(userId);
      } catch (error) {
        observabilityService.reportError(error, {
          source: 'operation',
          title: 'No se pudieron cargar settings desde Supabase',
          message: 'La lectura de configuración Supabase falló. Se intentará caché local si existe.',
          operationName: 'loadUserSettings',
          recoverable: true,
          userVisible: true,
          metadata: { errorCode: getErrorCode(error) },
        });
        return readLocal<Settings>(draftKeyFor(userId));
      }
    }
    return firebaseSettingsRepository.load(userId);
  },

  async save(settings, userId) {
    const env = runtimeEnv();
    if (userId && resolveBackend(env, 'settings').backend === 'supabase') {
      const repository = createSupabaseSettingsRepository(
        await loadSupabaseDataClient(env) as unknown as Parameters<typeof createSupabaseSettingsRepository>[0],
      );
      const result = await repository.save(settings, userId);
      if (!isWriteConfirmed(result) && result.status === 'offline') writeLocalDraft(draftKeyFor(userId), settings);
      return result;
    }
    return firebaseSettingsRepository.save(settings, userId);
  },

  clearCache() {
    firebaseSettingsRepository.clearCache();
  },
};

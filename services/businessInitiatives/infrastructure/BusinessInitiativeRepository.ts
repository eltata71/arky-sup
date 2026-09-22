/**
 * Persistence boundary for business initiatives.
 *
 * Same contract as `OfficeEngagementRepository`, for the same reasons:
 *
 *  - never throws — callers get a `PersistenceResult`-shaped outcome;
 *  - normalizes on read, so a hand-edited, partially-written or legacy
 *    document cannot crash a dashboard that rolls it up;
 *  - degrades to the local mirror this repository keeps when the database is
 *    unavailable.
 *
 * The normalizer is deliberately generous about what it accepts and strict
 * about what it returns: an initiative captured against an older schema, or
 * hand-edited straight in SQL, still loads with every field at a usable
 * default rather than taking the portfolio down.
 */

import { MirroredList, createFailureResult } from '../../persistence';
import type { PersistenceResult } from '../../persistence';
import { createSupabaseBusinessInitiativeRepository } from './SupabaseBusinessInitiativeRepository';
import { loadSupabaseDataClient } from '../../adapters';
import type { BusinessInitiative } from '../domain/BusinessInitiativeTypes';
import { normalizeInitiative } from '../domain/initiativeRecord';

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * El espejo está indexado por dueño, no por proyecto: `owner_id` es contra lo
 * que las políticas de `api.business_initiatives` autorizan leer y escribir,
 * igual que en `api.architecture_projects`. Por eso `deleteInitiative` exige
 * que el llamador diga de quién es la lista que hay que podar — si no, una
 * iniciativa borrada sobrevive en el espejo local y reaparece la próxima vez
 * que la base de datos no conteste.
 */
const mirror = new MirroredList<BusinessInitiative>((userId) => `businessInitiatives_${userId}`);

let remote: ReturnType<typeof createSupabaseBusinessInitiativeRepository> | null = null;

const getRemote = async () => {
  if (!remote) {
    const client = await loadSupabaseDataClient();
    remote = createSupabaseBusinessInitiativeRepository(
      client as unknown as Parameters<typeof createSupabaseBusinessInitiativeRepository>[0],
    );
  }
  return remote;
};

/** Solo para pruebas: olvida el repositorio remoto memorizado. */
export const resetInitiativeRepositoryCache = (): void => {
  remote = null;
  mirror.clear();
};

/**
 * Fuente única: PostgreSQL. El único espejo que sobrevive es el local, y nunca
 * se informa como confirmación remota.
 */
export const listInitiatives = async (userId: string): Promise<BusinessInitiative[]> => {
  const cached = mirror.cached(userId);
  const stored = cached ?? await (async () => {
    try {
      return mirror.remember(userId, await (await getRemote()).list(userId));
    } catch {
      return mirror.fallback(userId);
    }
  })();
  return stored
    .map((item) => normalizeInitiative(item, userId))
    .filter((item): item is BusinessInitiative => item !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const saveInitiative = async (
  initiative: BusinessInitiative,
): Promise<PersistenceResult<BusinessInitiative | void>> => {
  const next: BusinessInitiative = { ...initiative, updatedAt: new Date().toISOString() };
  let result: PersistenceResult<BusinessInitiative | void>;
  try {
    result = await (await getRemote()).save(next, next.userId);
  } catch (error) {
    result = createFailureResult('saveBusinessInitiative', error);
  }
  // El espejo guarda lo confirmado cuando lo hay —con su revisión nueva— y lo
  // enviado cuando no: en degradación el trabajo no se pierde, y `result` ya
  // dice que sólo está en local. Guardar lo enviado tras una confirmación
  // dejaría el testigo caducado y convertiría la siguiente escritura en un
  // conflicto.
  const stored = result.success && result.data ? result.data : next;
  mirror.upsert(stored.userId, stored, result);
  return result;
};

export const deleteInitiative = async (
  userId: string,
  initiativeId: string,
  expectedRevision = 0,
): Promise<PersistenceResult<void>> => {
  let result: PersistenceResult<void>;
  try {
    // La revisión del snapshot que se está viendo, no la de la última lectura.
    result = await (await getRemote()).remove(initiativeId, userId, expectedRevision);
  } catch (error) {
    result = createFailureResult('deleteBusinessInitiative', error);
  }
  if (result.success) mirror.remove(userId, initiativeId);
  return result;
};

/** Olvida lo cacheado. Lo usa el cierre de sesión. */
export const clearInitiativeCache = (): void => {
  mirror.clear();
};

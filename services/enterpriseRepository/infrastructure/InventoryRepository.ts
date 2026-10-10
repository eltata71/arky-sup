/**
 * Persistence boundary for the enterprise inventory. Never throws; normalizes
 * on read; degrades to the local mirror (never reported as a remote
 * confirmation). The mirror is keyed by owner, like the table.
 */

import { MirroredList, createFailureResult } from '../../persistence';
import type { PersistenceResult } from '../../persistence';
import { loadSupabaseDataClient } from '../../adapters';
import { createSupabaseInventoryRepository } from './SupabaseInventoryRepository';
import type { InventoryItem } from '../domain/InventoryTypes';
import { normalizeInventoryItem } from '../domain/inventoryRecord';

const mirror = new MirroredList<InventoryItem>((userId) => `enterpriseInventory_${userId}`);

let remote: ReturnType<typeof createSupabaseInventoryRepository> | null = null;

const getRemote = async () => {
  if (!remote) {
    const client = await loadSupabaseDataClient();
    remote = createSupabaseInventoryRepository(
      client as unknown as Parameters<typeof createSupabaseInventoryRepository>[0],
    );
  }
  return remote;
};

/** Solo para pruebas. */
export const resetInventoryRepositoryCache = (): void => {
  remote = null;
  mirror.clear();
};

export const listInventory = async (userId: string): Promise<InventoryItem[]> => {
  const cached = mirror.cached(userId);
  const stored = cached ?? await (async () => {
    try {
      return mirror.remember(userId, await (await getRemote()).list(userId));
    } catch {
      return mirror.fallback(userId);
    }
  })();
  return stored
    .map((item) => normalizeInventoryItem(item, userId))
    .filter((item): item is InventoryItem => item !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const saveInventoryItem = async (item: InventoryItem): Promise<PersistenceResult<InventoryItem | void>> => {
  const next: InventoryItem = { ...item, updatedAt: new Date().toISOString() };
  let result: PersistenceResult<InventoryItem | void>;
  try {
    result = await (await getRemote()).save(next, next.userId);
  } catch (error) {
    result = createFailureResult('saveInventoryItem', error);
  }
  // Lo confirmado (con su revisión nueva) cuando lo hay; lo enviado si no.
  const stored = result.success && result.data ? result.data : next;
  mirror.upsert(stored.userId, stored, result);
  return result;
};

export const deleteInventoryItem = async (
  userId: string,
  itemId: string,
  expectedRevision = 0,
): Promise<PersistenceResult<void>> => {
  let result: PersistenceResult<void>;
  try {
    result = await (await getRemote()).remove(itemId, userId, expectedRevision);
  } catch (error) {
    result = createFailureResult('deleteInventoryItem', error);
  }
  if (result.success) mirror.remove(userId, itemId);
  return result;
};

export const clearInventoryCache = (): void => {
  mirror.clear();
};

import type { InventoryItem } from '../domain/InventoryTypes';
import { normalizeInventoryItem } from '../domain/inventoryRecord';
import { createOperationId, supabaseFailure, type PersistenceResult } from '../../persistence';

/** Superficie mínima de PostgREST para el inventario; sin SDK en el dominio. */
export interface SupabaseInventoryClientLike {
  rpc(name: 'list_enterprise_inventory', args: Record<string, never>): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'save_enterprise_inventory_item', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'delete_enterprise_inventory_item', args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export interface SupabaseInventoryRepository {
  list(userId: string): Promise<InventoryItem[]>;
  save(item: InventoryItem, userId: string, expectedRevision?: number): Promise<PersistenceResult<InventoryItem>>;
  remove(itemId: string, userId: string, expectedRevision?: number): Promise<PersistenceResult<void>>;
}

const asItem = (value: unknown, fallbackUserId: string): InventoryItem | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as { data?: unknown; revision?: unknown };
  if (!Number.isInteger(row.revision) || (row.revision as number) < 1) return null;
  const item = normalizeInventoryItem(row.data, fallbackUserId);
  return item ? { ...item, revision: row.revision as number } : null;
};

/** `revision` es una columna: copiarla dentro del documento sería una segunda verdad obsoleta. */
const asDocument = (item: InventoryItem): Omit<InventoryItem, 'revision'> => {
  const { revision: _storedRevision, ...document } = item;
  return document;
};

export function createSupabaseInventoryRepository(client: SupabaseInventoryClientLike): SupabaseInventoryRepository {
  return {
    async list(userId) {
      const { data, error } = await client.rpc('list_enterprise_inventory', {});
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error('La respuesta remota del inventario no es una lista.');
      const items = data.map((row) => asItem(row, userId));
      if (items.some((item) => item === null)) {
        throw new Error('La respuesta remota del inventario contiene una fila inválida.');
      }
      return items as InventoryItem[];
    },

    async save(item, userId, expectedRevision = item.revision ?? 0) {
      const operationId = createOperationId('saveInventoryItem');
      if (item.userId !== userId) {
        return {
          status: 'validation-error', success: false, operationId, target: 'supabase',
          message: 'El elemento no pertenece a la sesión que intenta guardarlo.',
        };
      }
      const { data, error } = await client.rpc('save_enterprise_inventory_item', {
        p_item: asDocument(item),
        p_expected_revision: expectedRevision,
      });
      if (error) return supabaseFailure<InventoryItem>(operationId, error, 'No se pudo confirmar el elemento del inventario en Supabase.');
      const saved = asItem(data, userId);
      if (!saved) {
        return {
          status: 'failed', success: false, operationId, target: 'supabase',
          message: 'Supabase confirmó una respuesta de inventario inválida.',
        };
      }
      return { status: 'success', success: true, operationId, target: 'supabase', data: saved };
    },

    async remove(itemId, _userId, expectedRevision = 0) {
      const operationId = createOperationId('deleteInventoryItem');
      const { error } = await client.rpc('delete_enterprise_inventory_item', {
        p_id: itemId,
        p_expected_revision: expectedRevision,
      });
      if (error) return supabaseFailure<void>(operationId, error, 'No se pudo confirmar el borrado del elemento en Supabase.');
      return { status: 'success', success: true, operationId, target: 'supabase' };
    },
  };
}

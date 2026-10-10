import { describe, expect, it } from 'vitest';
import {
  createSupabaseInventoryRepository,
  type SupabaseInventoryClientLike,
} from '../../../services/enterpriseRepository/infrastructure/SupabaseInventoryRepository';
import { createInventoryItem, type InventoryItem } from '../../../services/enterpriseRepository';

const owner = '00000000-0000-4000-8000-000000000001';
const item = (): InventoryItem => {
  const r = createInventoryItem({ userId: owner, kind: 'technology', name: 'Kafka' }, { now: '2026-10-09T00:00:00.000Z', existing: [], newId: () => 'inv_kafka' });
  if (!r.ok) throw new Error('fábrica');
  return r.item;
};

function fake(options: { data?: unknown; error?: unknown } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: options.data ?? null, error: options.error ?? null };
    },
  } as unknown as SupabaseInventoryClientLike;
  return { client, calls };
}

describe('SupabaseInventoryRepository', () => {
  it('lista por RPC y trae la revisión con el elemento', async () => {
    const stored = item();
    const { client, calls } = fake({ data: [{ data: stored, revision: 3 }] });
    await expect(createSupabaseInventoryRepository(client).list(owner)).resolves.toEqual([{ ...stored, revision: 3 }]);
    expect(calls).toEqual([{ name: 'list_enterprise_inventory', args: {} }]);
  });

  it('falla si el servidor devuelve una fila sin revisión', async () => {
    const { client } = fake({ data: [{ data: item(), revision: 0 }] });
    await expect(createSupabaseInventoryRepository(client).list(owner)).rejects.toThrow();
  });

  it('guarda con revisión cero la primera vez y sin la revisión dentro del documento', async () => {
    const stored = item();
    const { client, calls } = fake({ data: { data: stored, revision: 1 } });
    const result = await createSupabaseInventoryRepository(client).save({ ...stored, revision: undefined }, owner);
    expect(result).toMatchObject({ success: true, target: 'supabase' });
    expect(calls[0].name).toBe('save_enterprise_inventory_item');
    expect(calls[0].args.p_expected_revision).toBe(0);
    expect(calls[0].args.p_item).not.toHaveProperty('revision');
  });

  it('rechaza guardar el elemento de otro usuario sin llamar al servidor', async () => {
    const { client, calls } = fake();
    const result = await createSupabaseInventoryRepository(client).save(item(), '00000000-0000-4000-8000-0000000000ff');
    expect(result).toMatchObject({ success: false, status: 'validation-error' });
    expect(calls).toEqual([]);
  });

  it('traduce un conflicto de revisión', async () => {
    const { client } = fake({ error: { code: 'P0001', message: 'Conflicto de inventario: recarga antes de guardar' } });
    const result = await createSupabaseInventoryRepository(client).save(item(), owner);
    expect(result).toMatchObject({ success: false, status: 'conflict' });
  });

  it('borra por RPC con la revisión vista', async () => {
    const { client, calls } = fake();
    const result = await createSupabaseInventoryRepository(client).remove('inv_kafka', owner, 4);
    expect(result.success).toBe(true);
    expect(calls).toEqual([{ name: 'delete_enterprise_inventory_item', args: { p_id: 'inv_kafka', p_expected_revision: 4 } }]);
  });
});

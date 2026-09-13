import { describe, expect, it } from 'vitest';
import {
  createSupabaseBusinessInitiativeRepository,
  type SupabaseBusinessInitiativesClientLike,
} from '../../../services/businessInitiatives';
import { buildInitiative, type BusinessInitiative } from '../../../services/businessInitiatives';
import { formatInitiativeCode } from '../../../lib/eaTerminology';

const ownerId = '00000000-0000-4000-8000-000000000001';
const initiative = (): BusinessInitiative => ({
  ...buildInitiative(
    { title: 'Simplificar alta digital', need: 'La alta tarda doce días' },
    ownerId,
    [],
    '2026-09-12T00:00:00.000Z',
  ),
  id: 'init_legacy_001',
  code: formatInitiativeCode(2026, 1),
});

interface FakeClient extends SupabaseBusinessInitiativesClientLike {
  readonly calls: Array<{ name: string; args: Record<string, unknown> }>;
}

function fakeClient(options: { data?: unknown; error?: unknown } = {}): FakeClient {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { data: options.data ?? null, error: options.error ?? null };
    },
    calls,
  };
}

describe('SupabaseBusinessInitiativeRepository', () => {
  it('conserva el id textual existente al leer, para no romper initiativeIds de proyectos', async () => {
    const saved = initiative();
    const client = fakeClient({ data: [{ data: saved, revision: 7 }] });
    const repository = createSupabaseBusinessInitiativeRepository(client);

    await expect(repository.list(ownerId)).resolves.toEqual([saved]);
    expect(client.calls).toEqual([{ name: 'list_business_initiatives', args: {} }]);
  });

  it('guarda por RPC con revisión cero hasta conocer una versión remota', async () => {
    const saved = initiative();
    const client = fakeClient({ data: { data: saved, revision: 1 } });
    const repository = createSupabaseBusinessInitiativeRepository(client);

    const result = await repository.save(saved, ownerId);

    expect(result).toMatchObject({ success: true, status: 'success', target: 'supabase', data: saved });
    expect(client.calls).toEqual([{
      name: 'save_business_initiative',
      args: { p_initiative: saved, p_expected_revision: 0 },
    }]);
  });

  it('no presenta como confirmada una revisión obsoleta', async () => {
    const client = fakeClient({ error: { code: 'P0001', message: 'Conflicto de iniciativa' } });
    const repository = createSupabaseBusinessInitiativeRepository(client);

    const result = await repository.save(initiative(), ownerId, 3);

    expect(result).toMatchObject({ success: false, status: 'conflict', target: 'supabase' });
  });

  it('elimina con la revisión que leyó, no con una supuesta', async () => {
    const saved = initiative();
    const client = fakeClient({ data: [{ data: saved, revision: 4 }] });
    const repository = createSupabaseBusinessInitiativeRepository(client);
    await repository.list(ownerId);

    const result = await repository.remove(saved.id, ownerId);

    expect(result).toMatchObject({ success: true, status: 'success', target: 'supabase' });
    expect(client.calls.at(-1)).toEqual({
      name: 'delete_business_initiative',
      args: { p_id: saved.id, p_expected_revision: 4 },
    });
  });
});

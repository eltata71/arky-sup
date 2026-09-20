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

    // La revisión viaja **con el agregado** que vuelve, no en un mapa por id.
    await expect(repository.list(ownerId)).resolves.toEqual([{ ...saved, revision: 7 }]);
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

  it('elimina con la revisión que le pasa quien borra', async () => {
    const saved = initiative();
    const client = fakeClient({ data: [{ data: saved, revision: 4 }] });
    const repository = createSupabaseBusinessInitiativeRepository(client);
    const [listed] = await repository.list(ownerId);

    const result = await repository.remove(saved.id, ownerId, listed.revision ?? 0);

    expect(result).toMatchObject({ success: true, status: 'success', target: 'supabase' });
    expect(client.calls.at(-1)).toEqual({
      name: 'delete_business_initiative',
      args: { p_id: saved.id, p_expected_revision: 4 },
    });
  });
});

describe('la revisión no puede prestarse entre snapshots', () => {
  /**
   * El mismo defecto que tenían los encargos, línea por línea. La revisión
   * vivía en un `Map<string, number>` dentro del cierre del repositorio, así
   * que cualquier `list()` la refrescaba para todas las iniciativas: una
   * pantalla con un snapshot anterior guardaba con la revisión **más nueva** y
   * la guarda optimista del servidor, que existe justo para detener eso, la
   * dejaba pasar. La actualización perdida no se detectaba: se confirmaba.
   */
  it('una escritura desde un snapshot viejo no usa la revisión de la última lectura', async () => {
    const client = fakeClient({ data: [{ data: initiative(), revision: 9 }] });
    const repository = createSupabaseBusinessInitiativeRepository(client);

    const stale = { ...initiative(), revision: 2, title: 'Título de hace un rato' };
    await repository.list(ownerId);
    await repository.save(stale, ownerId);

    expect(client.calls.at(-1)?.args.p_expected_revision).toBe(2);
  });

  it('una iniciativa sin testigo espera no existir, en vez de pisar lo que haya', async () => {
    const client = fakeClient({ data: [{ data: initiative(), revision: 9 }] });
    const repository = createSupabaseBusinessInitiativeRepository(client);
    await repository.list(ownerId);

    await repository.save(initiative(), ownerId);

    expect(client.calls.at(-1)?.args.p_expected_revision).toBe(0);
  });

  it('no envía el testigo dentro del documento', async () => {
    const client = fakeClient({ data: { data: initiative(), revision: 3 } });
    const repository = createSupabaseBusinessInitiativeRepository(client);

    await repository.save({ ...initiative(), revision: 2 }, ownerId);

    expect(client.calls.at(-1)?.args.p_initiative).not.toHaveProperty('revision');
  });

  it('clasifica 23503 como validación y propaga el mensaje que nombra los proyectos', async () => {
    // La tabla local de códigos no conocía 23503 — el código con el que el
    // servidor rechaza borrar una iniciativa que un proyecto cita — así que ese
    // rechazo se leía como un `failed` genérico y el mensaje útil, el que
    // nombra los proyectos a desvincular, se perdía.
    const client = fakeClient({
      error: {
        code: '23503',
        message: 'La iniciativa la citan 2 proyecto(s): Atención A, Atención B. '
          + 'Desvincúlalos antes de borrarla.',
      },
    });
    const repository = createSupabaseBusinessInitiativeRepository(client);

    const result = await repository.remove('init_legacy_001', ownerId, 1);

    expect(result.status).toBe('validation-error');
    expect(result.message).toContain('Atención A');
  });
});

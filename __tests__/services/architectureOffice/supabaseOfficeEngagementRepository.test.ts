import { describe, expect, it } from 'vitest';
import {
  createSupabaseOfficeEngagementRepository,
  type SupabaseOfficeClientLike,
} from '../../../services/architectureOffice';
import {
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
} from '../../../services/architectureOffice/OfficeTypes';

const ownerId = '00000000-0000-4000-8000-000000000001';
const adminId = '00000000-0000-4000-8000-000000000002';

const engagement = (): OfficeEngagement => ({
  id: 'eng_legacy_001',
  projectId: 'proj_legacy_001',
  schemaVersion: 1,
  title: 'Encargo de prueba',
  brief: 'Brief original',
  initiativeIds: ['init_legacy_001'],
  businessProjectIds: [],
  status: 'in-progress',
  priority: 'medium',
  charter: {
    kind: 'new-solution', objectives: [], scope: [], outOfScope: [], constraints: [],
    regulatoryDrivers: [], deliverables: [], participantIds: [],
    coordinatorId: 'lucia', consolidatorId: 'alejandro',
    provenance: 'deterministic', proposedAt: '2026-09-12T00:00:00.000Z',
  },
  tasks: [],
  arbDecisions: [],
  budget: { maxAiCalls: 40, consumedAiCalls: 0 },
  auditTrail: [],
  createdBy: { id: ownerId, name: 'Arquitecto', role: 'architect' },
  createdAt: '2026-09-12T00:00:00.000Z',
  updatedAt: '2026-09-12T00:00:00.000Z',
});

const decision = () => ({
  id: 'arb_legacy_001',
  engagementId: 'eng_legacy_001',
  verdict: 'approved' as const,
  rationale: 'Aprobado por el comité',
  actor: { id: adminId, name: 'Admin', role: 'admin' },
  gateStatusAtDecision: 'pass' as const,
  previousStatus: 'awaiting-arb' as const,
  decidedAt: '2026-09-12T00:00:00.000Z',
});

interface FakeClient extends SupabaseOfficeClientLike {
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
  } as FakeClient;
}

describe('SupabaseOfficeEngagementRepository', () => {
  it('lista encargos propios y pega la revisión al agregado que devuelve', async () => {
    const saved = engagement();
    const client = fakeClient({ data: [{ data: { ...saved, arbDecisions: [] }, revision: 3 }] });
    const repository = createSupabaseOfficeEngagementRepository(client);
    const result = await repository.list('proj_legacy_001');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('eng_legacy_001');
    expect(client.calls[0].name).toBe('load_engagements');
    // La revisión viaja **con el snapshot**, no en un mapa por id.
    expect(result[0].revision).toBe(3);
    await repository.save(result[0]);
    expect(client.calls[1].args.p_expected_revision).toBe(3);
  });

  it('no envía la revisión dentro del documento', () => {
    // Es una columna. Una copia dentro del JSON sería una segunda verdad sobre
    // el mismo hecho, y además una que nace obsoleta: la fila la incrementa el
    // `on conflict do update`, así que la copia quedaría siempre una por detrás.
    const client = fakeClient({ data: { data: { ...engagement() }, revision: 2 } });
    const repository = createSupabaseOfficeEngagementRepository(client);
    return repository.save({ ...engagement(), revision: 1 }).then(() => {
      expect(client.calls[0].args.p_expected_revision).toBe(1);
      expect(client.calls[0].args.p_engagement).not.toHaveProperty('revision');
    });
  });

  it('devuelve el encargo guardado con la revisión nueva', async () => {
    const client = fakeClient({ data: { data: { ...engagement() }, revision: 4 } });
    const repository = createSupabaseOfficeEngagementRepository(client);
    const result = await repository.save({ ...engagement(), revision: 3 });
    expect(result.success).toBe(true);
    expect(result.data?.revision).toBe(4);
  });

  it('reemplaza el espejo arbDecisions del documento por el del registro remoto', async () => {
    const saved = engagement();
    const remote = { ...saved, arbDecisions: [decision()] };
    const client = fakeClient({ data: [{ data: remote, revision: 1 }] });
    const repository = createSupabaseOfficeEngagementRepository(client);
    const result = await repository.list('proj_legacy_001');
    expect(result[0].arbDecisions).toEqual([decision()]);
  });

  it('reporta conflicto P0001 como revisión obsoleta', async () => {
    const client = fakeClient({ error: { code: 'P0001', message: 'Conflicto de encargo' } });
    const repository = createSupabaseOfficeEngagementRepository(client);
    const result = await repository.save(engagement());
    expect(result.success).toBe(false);
    expect(result.status).toBe('conflict');
  });

  it('reporta permiso insuficiente 42501 como permission-denied', async () => {
    const client = fakeClient({ error: { code: '42501', message: 'Permiso insuficiente: arb:decide' } });
    const repository = createSupabaseOfficeEngagementRepository(client);
    const result = await repository.decide(engagement(), decision());
    expect(result.success).toBe(false);
    expect(result.status).toBe('permission-denied');
  });

  it('firma y transiciona con una sola llamada, llevando la revisión del snapshot', async () => {
    const client = fakeClient({ data: { data: { ...engagement(), status: 'delivered' }, revision: 6 } });
    const repository = createSupabaseOfficeEngagementRepository(client);

    const result = await repository.decide({ ...engagement(), revision: 5 }, decision());

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].name).toBe('decide_engagement');
    expect(client.calls[0].args.p_expected_revision).toBe(5);
    expect(client.calls[0].args.p_decision).toEqual(decision());
    // El testigo tampoco viaja aquí dentro del documento.
    expect(client.calls[0].args.p_engagement).not.toHaveProperty('revision');
    expect(result.success).toBe(true);
    expect(result.data?.revision).toBe(6);
  });

  it('borra por proyecto textual con la revisión que le pasa quien borra', async () => {
    const client = fakeClient({ data: [{ data: { ...engagement() }, revision: 4 }] });
    const repository = createSupabaseOfficeEngagementRepository(client);
    const [listed] = await repository.list('proj_legacy_001');
    const result = await repository.remove('proj_legacy_001', listed.id, listed.revision ?? 0);
    expect(result.success).toBe(true);
    expect(client.calls[1].args.p_project_id).toBe('proj_legacy_001');
    expect(client.calls[1].args.p_engagement_id).toBe('eng_legacy_001');
    expect(client.calls[1].args.p_expected_revision).toBe(4);
  });
});

describe('la revisión no puede prestarse entre snapshots', () => {
  /**
   * La reproducción del defecto, y la razón de que exista el campo.
   *
   * Antes la revisión vivía en un `Map<string, number>` dentro del cierre del
   * repositorio —que es un singleton de módulo—, así que cualquier `list()`
   * la refrescaba para todos los encargos. El guion era éste: una pantalla lee
   * el encargo en revisión 3, otra sesión lo edita y lo deja en 7, esta
   * pantalla recarga la lista —el mapa pasa a 7— y guarda **su** snapshot
   * viejo. La escritura salía con `p_expected_revision: 7`, el servidor la
   * aceptaba, y la edición de la otra sesión desaparecía. La guarda optimista
   * no falló: se le mintió.
   */
  it('una escritura desde un snapshot viejo no usa la revisión de la última lectura', async () => {
    const client = fakeClient({ data: [{ data: { ...engagement() }, revision: 7 }] });
    const repository = createSupabaseOfficeEngagementRepository(client);

    // La pantalla retiene un snapshot de la revisión 3…
    const stale: OfficeEngagement = { ...engagement(), revision: 3, title: 'Título de hace un rato' };
    // …y algo recarga la lista, que ahora viene en 7.
    await repository.list('proj_legacy_001');

    await repository.save(stale);
    expect(client.calls[1].args.p_expected_revision).toBe(3);
  });

  it('un encargo sin revisión espera no existir, en vez de pisar lo que haya', async () => {
    const client = fakeClient({ data: [{ data: { ...engagement() }, revision: 9 }] });
    const repository = createSupabaseOfficeEngagementRepository(client);
    await repository.list('proj_legacy_001');

    const { revision: _none, ...withoutToken } = engagement();
    await repository.save(withoutToken as OfficeEngagement);
    // Cero, no nueve: el fallo va hacia el conflicto, nunca hacia la escritura.
    expect(client.calls[1].args.p_expected_revision).toBe(0);
  });
});
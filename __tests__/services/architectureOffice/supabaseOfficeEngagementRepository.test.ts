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
  it('lista encargos propios y fija la revisión observada', async () => {
    const saved = engagement();
    const client = fakeClient({ data: [{ data: { ...saved, arbDecisions: [] }, revision: 3 }] });
    const repository = createSupabaseOfficeEngagementRepository(client);
    const result = await repository.list('proj_legacy_001');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('eng_legacy_001');
    expect(client.calls[0].name).toBe('load_engagements');
    // Segunda escritura usa la revisión observada, no cero.
    await repository.save(saved);
    expect(client.calls[1].args.p_expected_revision).toBe(3);
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
    const result = await repository.recordArbDecision(engagement(), decision());
    expect(result.success).toBe(false);
    expect(result.status).toBe('permission-denied');
  });

  it('borra por proyecto textual con revisión optimista y limpia la revisión observada', async () => {
    const client = fakeClient({ data: [{ data: { ...engagement() }, revision: 4 }] });
    const repository = createSupabaseOfficeEngagementRepository(client);
    await repository.list('proj_legacy_001');
    const result = await repository.remove('proj_legacy_001', 'eng_legacy_001');
    expect(result.success).toBe(true);
    expect(client.calls[1].args.p_project_id).toBe('proj_legacy_001');
    expect(client.calls[1].args.p_engagement_id).toBe('eng_legacy_001');
    expect(client.calls[1].args.p_expected_revision).toBe(4);
  });
});
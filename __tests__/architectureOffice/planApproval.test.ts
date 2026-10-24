/**
 * La persona aprueba el plan del equipo antes de gastar (plan de agentes 20.2).
 */
import { describe, expect, it, vi } from 'vitest';
import {
  coordinateRequest,
  type CoordinationScope,
} from '../../services/architectureOffice/application/officeCoordination';
import { planOfficeWorkstreams } from '../../services/architectureOffice/application/officeOrchestration';
import {
  APPROVAL_SPECIALIST_THRESHOLD,
  applyApprovalDecision,
  proposeFromPlan,
  requiresPlanApproval,
  type PlanApprovalDecision,
  type PlanApprovalProposal,
} from '../../services/architectureOffice/application/planApproval';

const scope: CoordinationScope = { level: 'project', id: 'p1', name: 'Núcleo de pólizas', briefing: [] };

const BIG = 'Diseña la integración de pólizas con AWS, la seguridad y el cumplimiento HIPAA, el modelo de datos de siniestros y la estrategia de pruebas de rendimiento.';
const SMALL = 'Qué estándar FHIR conviene para el intercambio de historias clínicas.';

describe('requiresPlanApproval', () => {
  it('pide aprobación con el umbral de especialistas o más', () => {
    const big = planOfficeWorkstreams(BIG);
    expect(big.workstreams.length).toBeGreaterThanOrEqual(APPROVAL_SPECIALIST_THRESHOLD);
    expect(requiresPlanApproval(big)).toBe(true);
    expect(requiresPlanApproval(planOfficeWorkstreams(SMALL))).toBe(false);
  });
});

describe('applyApprovalDecision', () => {
  const plan = planOfficeWorkstreams(BIG);
  const ids = plan.workstreams.map((workstream) => workstream.personaId);

  it('cancelar cancela', () => {
    expect(applyApprovalDecision(plan, { decision: 'cancel' })).toEqual({ outcome: 'cancelled' });
  });

  it('aprobar sin quitar a nadie conserva el plan', () => {
    const result = applyApprovalDecision(plan, { decision: 'approve' });
    expect(result).toMatchObject({ outcome: 'approved', removed: [] });
  });

  it('quita sólo a quien está en el plan', () => {
    const result = applyApprovalDecision(plan, { decision: 'approve', removeSpecialists: [ids[0], 'nadie' as never] });
    expect(result.outcome).toBe('approved');
    if (result.outcome !== 'approved') return;
    expect(result.removed).toEqual([ids[0]]);
    expect(result.plan.workstreams.map((workstream) => workstream.personaId)).not.toContain(ids[0]);
  });

  it('nunca deja el equipo vacío: quitar a todos no se aplica', () => {
    const result = applyApprovalDecision(plan, { decision: 'approve', removeSpecialists: ids as never[] });
    expect(result).toMatchObject({ outcome: 'approved', removed: [] });
    if (result.outcome === 'approved') expect(result.plan.workstreams).toHaveLength(plan.workstreams.length);
  });

  it('la propuesta acota las llamadas: un análisis por especialista, consolidación y una corrección (sin coordinadora, 21.2)', () => {
    expect(proposeFromPlan(plan).maxModelCalls).toBe(plan.workstreams.length + 2);
  });
});

describe('coordinateRequest con aprobación', () => {
  const run = (request: string, approval?: (proposal: PlanApprovalProposal) => Promise<PlanApprovalDecision>) => {
    const invoke = vi.fn(async (_personaId: string) => '{}');
    const promise = coordinateRequest({ request, scope, invoke, approval });
    return { invoke, promise };
  };

  it('por debajo del umbral no pregunta y trabaja como siempre', async () => {
    const approval = vi.fn(async () => ({ decision: 'cancel' }) as PlanApprovalDecision);
    const { invoke, promise } = run(SMALL, approval);
    await promise;
    expect(approval).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalled();
  });

  it('sin puerto de aprobación tampoco cambia nada, aunque el plan sea grande', async () => {
    const { invoke, promise } = run(BIG);
    await promise;
    expect(invoke).toHaveBeenCalled();
  });

  it('nada se invoca antes de aprobar', async () => {
    let release: (decision: PlanApprovalDecision) => void = () => undefined;
    const approval = vi.fn(() => new Promise<PlanApprovalDecision>((resolve) => { release = resolve; }));
    const { invoke, promise } = run(BIG, approval);
    await Promise.resolve();
    await Promise.resolve();
    expect(approval).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    release({ decision: 'approve' });
    await promise;
    expect(invoke).toHaveBeenCalled();
  });

  it('cancelar no invoca a nadie y no deja estado a medias', async () => {
    const { invoke, promise } = run(BIG, async () => ({ decision: 'cancel' }));
    const outcome = await promise;
    expect(invoke).not.toHaveBeenCalled();
    expect(outcome.cancelled).toBe(true);
    expect(outcome.status).toBe('failed');
    expect(outcome.contributions).toEqual([]);
    expect(outcome.events.map((event) => event.kind)).toEqual(['request-received', 'approval-requested', 'operation-cancelled']);
  });

  it('quitar un especialista lo saca del equipo y de las llamadas', async () => {
    const plan = planOfficeWorkstreams(BIG);
    const removed = plan.workstreams[0].personaId;
    const { invoke, promise } = run(BIG, async () => ({ decision: 'approve', removeSpecialists: [removed as never] }));
    const outcome = await promise;
    expect(outcome.team.filter((member) => member.role === 'specialist').map((member) => member.personaId)).not.toContain(removed);
    expect(invoke.mock.calls.map((call) => call[0])).not.toContain(removed);
    expect(outcome.events.some((event) => event.kind === 'approval-decided')).toBe(true);
  });

  it('una pantalla que falla no aprueba: ante la duda no se gasta', async () => {
    const { invoke, promise } = run(BIG, async () => { throw new Error('se cerró el panel'); });
    const outcome = await promise;
    expect(invoke).not.toHaveBeenCalled();
    expect(outcome.cancelled).toBe(true);
  });
});

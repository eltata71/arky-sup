import { describe, expect, it } from 'vitest';
import {
  approveCharter,
  attachGateAssessment,
  canActAsArb,
  decideEngagement,
  describeArbDecisionEligibility,
} from '../../services/architectureOffice/domain/OfficeArbService';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeActor,
  type OfficeEngagement,
  type OfficeEngagementStatus,
  type OfficeTask,
} from '../../services/architectureOffice/domain/OfficeTypes';
import type { OfficeQualityAssessment } from '../../services/architectureOffice/domain/officeQualityGates';

const ADMIN: OfficeActor = { id: 'user-1', name: 'Ana Admin', role: 'admin' };
const AUTHOR: OfficeActor = { id: 'user-2', name: 'Beto Arquitecto', role: 'student' };

const assessment = (overallStatus: OfficeQualityAssessment['overallStatus']): OfficeQualityAssessment => ({
  overallStatus,
  evaluatedAt: '2026-08-26T00:00:00.000Z',
  gates: [{
    id: 'security-review',
    status: overallStatus,
    evidenceArtifactIds: [],
    blockers: overallStatus === 'blocked' ? ['Falta el Threat Model STRIDE.'] : [],
    conditions: [],
  }],
});

const engagement = (
  status: OfficeEngagementStatus,
  overrides: Partial<OfficeEngagement> = {},
): OfficeEngagement => ({
  id: 'eng-1',
  projectId: 'proj-1',
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: 'Encargo',
  brief: 'brief',
  businessProjectIds: [],
  initiativeIds: [],
  priority: 'medium' as const,
  status,
  charter: {
    kind: 'new-solution',
    objectives: [],
    scope: [],
    outOfScope: [],
    constraints: [],
    regulatoryDrivers: [],
    deliverables: [{
      templateName: 'Visión de la Arquitectura',
      artifactType: 'markdown',
      assigneeId: 'felipe',
      reviewerId: 'elena',
      rationale: 'r',
      dependsOnTemplateNames: [],
    }],
    participantIds: ['felipe', 'elena'],
    coordinatorId: 'lucia',
    consolidatorId: 'alejandro',
    provenance: 'deterministic',
    proposedAt: '2026-08-26T00:00:00.000Z',
  },
  tasks: [],
  arbDecisions: [],
  budget: { ...DEFAULT_OFFICE_BUDGET },
  auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
  ...overrides,
});

describe('OfficeArbService — charter approval', () => {
  it('releases the engagement to the runner and records who approved', () => {
    const result = approveCharter(engagement('awaiting-charter'), AUTHOR);
    expect(result.ok).toBe(true);
    expect(result.engagement.status).toBe('in-progress');
    expect(result.engagement.charter.approvedBy).toEqual(AUTHOR);
    expect(result.engagement.charter.approvedAt).toBeTruthy();
    expect(result.engagement.auditTrail.map((entry) => entry.action)).toContain('charter-approved');
  });

  it('refuses to approve from an illegal state', () => {
    const result = approveCharter(engagement('delivered'), AUTHOR);
    expect(result.ok).toBe(false);
    expect(result.engagement.status).toBe('delivered');
    expect(result.reason).toMatch(/delivered/);
  });

  it('refuses to approve an empty charter', () => {
    const empty = engagement('awaiting-charter');
    const result = approveCharter(
      { ...empty, charter: { ...empty.charter, deliverables: [] } },
      AUTHOR,
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/entregables/);
  });

  it('never mutates the input engagement', () => {
    const input = engagement('awaiting-charter');
    const snapshot = JSON.stringify(input);
    approveCharter(input, AUTHOR);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('OfficeArbService — board decision', () => {
  it('recognises only admin roles as board members', () => {
    expect(canActAsArb(ADMIN)).toBe(true);
    expect(canActAsArb({ ...ADMIN, role: 'superadmin' })).toBe(true);
    expect(canActAsArb(AUTHOR)).toBe(false);
    expect(canActAsArb(null)).toBe(false);
  });

  it('refuses a decision from a non-admin — separation of duties', () => {
    const result = decideEngagement(
      engagement('awaiting-arb', { gateAssessment: assessment('pass') }),
      { verdict: 'approved', rationale: '', actor: AUTHOR },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/administrador/i);
  });

  /**
   * Quién puede firmar **este** encargo, que no es quién puede firmar.
   *
   * El servidor rechaza con `42501` que el autor decida lo suyo desde F2-03
   * (opción C, ADR-101). La pantalla seguía leyendo sólo el permiso, así que
   * ofrecía «Aprobar entrega» habilitado a quien iba a recibir ese error —y el
   * único sitio donde se notó fue un recorrido E2E, cuatro fases después.
   */
  describe('elegibilidad por encargo', () => {
    const boardMember: OfficeActor = { ...ADMIN };
    const authored = (author: OfficeActor): OfficeEngagement =>
      engagement('awaiting-arb', { gateAssessment: assessment('pass'), createdBy: author });

    it('deja firmar a un miembro del comité que no lo escribió', () => {
      expect(describeArbDecisionEligibility(authored(AUTHOR), boardMember))
        .toEqual({ allowed: true });
    });

    it('se lo niega al autor aunque tenga el permiso', () => {
      // El caso que importa: un `reviewer`, `admin` o `superadmin` mirando un
      // encargo suyo. `canActAsArb` dice que sí y el servidor dice que no.
      expect(canActAsArb(boardMember)).toBe(true);
      expect(describeArbDecisionEligibility(authored(boardMember), boardMember))
        .toEqual({ allowed: false, reason: 'own-engagement' });
    });

    it('nombra la falta de permiso antes que la autoría cuando faltan las dos', () => {
      // Precedencia deliberada: no tener el permiso es la razón más general, y
      // es la que sigue siendo cierta si el encargo cambia de autor.
      expect(describeArbDecisionEligibility(authored(AUTHOR), AUTHOR))
        .toEqual({ allowed: false, reason: 'missing-permission' });
    });

    it('falla cerrado sin sesión', () => {
      expect(describeArbDecisionEligibility(authored(AUTHOR), null))
        .toEqual({ allowed: false, reason: 'missing-permission' });
    });

    it('la regla rechaza al autor antes de tocar la red, y lo dice con sus palabras', () => {
      const result = decideEngagement(authored(boardMember), {
        verdict: 'approved', rationale: '', actor: boardMember,
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/no firma su decisión|separación de funciones/i);
      // Y no deja una decisión a medias que alguien pueda dar por registrada.
      expect(result.decision).toBeUndefined();
      expect(result.engagement.status).toBe('awaiting-arb');
    });
  });

  it('refuses a decision when the engagement is not before the board', () => {
    const result = decideEngagement(
      engagement('in-progress', { gateAssessment: assessment('pass') }),
      { verdict: 'approved', rationale: '', actor: ADMIN },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no está en revisión/i);
  });

  it('cannot approve past a blocked quality gate', () => {
    const result = decideEngagement(
      engagement('awaiting-arb', { gateAssessment: assessment('blocked') }),
      { verdict: 'approved', rationale: 'Confío en el equipo', actor: ADMIN },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/bloqueados/);
    expect(result.reason).toContain('Threat Model');
  });

  it('allows approval over a conditional gate — that is the board judgement call', () => {
    const result = decideEngagement(
      engagement('awaiting-arb', { gateAssessment: assessment('conditional') }),
      { verdict: 'approved', rationale: 'Condiciones aceptadas por el comité.', actor: ADMIN },
    );
    expect(result.ok).toBe(true);
    expect(result.engagement.status).toBe('delivered');
    expect(result.decision?.gateStatusAtDecision).toBe('conditional');
  });

  it('requires a written rationale to request changes or reject', () => {
    const base = engagement('awaiting-arb', { gateAssessment: assessment('pass') });
    for (const verdict of ['changes-requested', 'rejected'] as const) {
      const result = decideEngagement(base, { verdict, rationale: '   ', actor: ADMIN });
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/motivo/i);
    }
  });

  it('sends a changes-requested engagement back to execution', () => {
    const result = decideEngagement(
      engagement('awaiting-arb', { gateAssessment: assessment('pass') }),
      { verdict: 'changes-requested', rationale: 'Falta la vista de despliegue.', actor: ADMIN },
    );
    expect(result.ok).toBe(true);
    expect(result.engagement.status).toBe('in-progress');
    expect(result.decision?.previousStatus).toBe('awaiting-arb');
  });

  it('requires justification to approve an engagement with failed deliverables', () => {
    const failedTask: OfficeTask = {
      id: 't1', engagementId: 'eng-1', kind: 'produce-artifact', title: 'x', objective: '',
      assigneeId: 'felipe', dependsOn: [], acceptanceCriteria: [], status: 'failed',
      attempts: 2, maxAttempts: 2,
    };
    const withFailure = engagement('awaiting-arb', {
      gateAssessment: assessment('pass'),
      tasks: [failedTask],
    });

    expect(decideEngagement(withFailure, { verdict: 'approved', rationale: '', actor: ADMIN }).ok).toBe(false);
    expect(decideEngagement(withFailure, {
      verdict: 'approved',
      rationale: 'El entregable fallido no es necesario para esta entrega.',
      actor: ADMIN,
    }).ok).toBe(true);
  });

  it('records an immutable decision carrying the evidence it rested on', () => {
    const result = decideEngagement(
      engagement('awaiting-arb', { gateAssessment: assessment('pass') }),
      { verdict: 'approved', rationale: 'Todo en orden.', actor: ADMIN },
    );
    expect(result.decision).toMatchObject({
      engagementId: 'eng-1',
      verdict: 'approved',
      actor: ADMIN,
      gateStatusAtDecision: 'pass',
      previousStatus: 'awaiting-arb',
    });
    expect(result.decision?.decidedAt).toBeTruthy();
    expect(result.engagement.arbDecisions).toHaveLength(1);
    const actions = result.engagement.auditTrail.map((entry) => entry.action);
    expect(actions).toContain('arb-decided');
    expect(actions).toContain('engagement-delivered');
  });

  it('can decide a blocked engagement so the board is never a dead end', () => {
    const result = decideEngagement(
      engagement('blocked', { gateAssessment: assessment('conditional') }),
      { verdict: 'rejected', rationale: 'El encargo no es viable como está planteado.', actor: ADMIN },
    );
    expect(result.ok).toBe(true);
    expect(result.engagement.status).toBe('cancelled');
  });
});

describe('OfficeArbService — gate assessment', () => {
  it('attaches the assessment and audits it', () => {
    const result = attachGateAssessment(engagement('awaiting-arb'), assessment('conditional'));
    expect(result.gateAssessment?.overallStatus).toBe('conditional');
    expect(result.auditTrail.map((entry) => entry.action)).toContain('gates-evaluated');
  });
});

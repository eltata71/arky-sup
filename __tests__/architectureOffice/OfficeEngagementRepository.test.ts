import { describe, expect, it } from 'vitest';
import {
  buildAuditEntry,
  newArbDecisionId,
  newEngagementId,
  newOfficeTaskId,
  normalizeEngagement,
  withAuditEntry,
} from '../../services/architectureOffice/domain/officeEngagementRecord';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  selectSchedulableTasks,
  type OfficeEngagement,
} from '../../services/architectureOffice/domain/OfficeTypes';

const storedEngagement = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'eng-1',
  projectId: 'proj-1',
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: 'Encargo',
  brief: 'brief',
  businessProjectIds: ['NEG-2026-001'],
  initiativeIds: [],
  priority: 'medium' as const,
  status: 'in-progress',
  charter: {
    kind: 'modernization',
    objectives: ['o'],
    scope: [], outOfScope: [], constraints: [], regulatoryDrivers: [],
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
  tasks: [
    {
      id: 'p1', engagementId: 'eng-1', kind: 'produce-artifact', title: 'Visión',
      objective: '', assigneeId: 'felipe', reviewerId: 'elena', dependsOn: [],
      acceptanceCriteria: [], status: 'completed', attempts: 1, maxAttempts: 2,
      producedArtifactId: 'art-1',
    },
    {
      id: 'r1', engagementId: 'eng-1', kind: 'review-artifact', title: 'Revisión',
      objective: '', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1',
      acceptanceCriteria: [], status: 'pending', attempts: 0, maxAttempts: 1,
    },
  ],
  arbDecisions: [],
  budget: { maxAiCalls: 40, consumedAiCalls: 3 },
  auditTrail: [],
  createdBy: { id: 'u1', name: 'Ana', role: 'admin' },
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T01:00:00.000Z',
  ...overrides,
});

describe('OfficeEngagementRepository — ids', () => {
  it('mints prefixed, unique ids', () => {
    expect(newEngagementId()).toMatch(/^eng_/);
    expect(newOfficeTaskId()).toMatch(/^task_/);
    expect(newArbDecisionId()).toMatch(/^arb_/);
    expect(newEngagementId()).not.toBe(newEngagementId());
  });
});

describe('OfficeEngagementRepository — normalization', () => {
  it('round-trips a well-formed engagement', () => {
    const result = normalizeEngagement(storedEngagement(), 'proj-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('eng-1');
    expect(result!.status).toBe('in-progress');
    expect(result!.tasks).toHaveLength(2);
    expect(result!.budget.consumedAiCalls).toBe(3);
  });

  it('rejects a document with no usable identity rather than inventing one', () => {
    expect(normalizeEngagement(null, 'proj-1')).toBeNull();
    expect(normalizeEngagement({}, 'proj-1')).toBeNull();
    expect(normalizeEngagement('nope', 'proj-1')).toBeNull();
  });

  it('falls back to the safest value for an unknown status instead of dropping the engagement', () => {
    const result = normalizeEngagement(storedEngagement({ status: 'martian' }), 'proj-1');
    expect(result!.status).toBe('intake');
  });

  it('drops a task whose assignee is not a known persona', () => {
    const document = storedEngagement();
    (document.tasks as Record<string, unknown>[])[1].assigneeId = 'houdini';
    const result = normalizeEngagement(document, 'proj-1');
    expect(result!.tasks.map((task) => task.id)).toEqual(['p1']);
  });

  it('coerces an unknown task status to pending so the runner can still schedule it', () => {
    const document = storedEngagement();
    (document.tasks as Record<string, unknown>[])[1].status = 'levitating';
    const result = normalizeEngagement(document, 'proj-1');
    expect(result!.tasks.find((task) => task.id === 'r1')?.status).toBe('pending');
  });

  it('normalizes business project ids at the boundary', () => {
    const result = normalizeEngagement(
      storedEngagement({ businessProjectIds: ['NEG-2026-001', 'basura', 42] }),
      'proj-1',
    );
    expect(result!.businessProjectIds).toEqual(['NEG-2026-001']);
  });

  it('repairs a missing budget rather than leaving the runner without a ceiling', () => {
    const result = normalizeEngagement(storedEngagement({ budget: undefined }), 'proj-1');
    expect(result!.budget.maxAiCalls).toBe(DEFAULT_OFFICE_BUDGET.maxAiCalls);
    expect(result!.budget.consumedAiCalls).toBe(0);
  });

  it('repairs a charter missing its coordinator and consolidator', () => {
    const result = normalizeEngagement(storedEngagement({ charter: { deliverables: [] } }), 'proj-1');
    expect(result!.charter.coordinatorId).toBe('lucia');
    expect(result!.charter.consolidatorId).toBe('alejandro');
    expect(result!.charter.kind).toBe('new-solution');
  });

  it('keeps a partially written engagement resumable — the point of persisting per transition', () => {
    const result = normalizeEngagement(storedEngagement(), 'proj-1')!;
    // `p1` already completed, so only its review is schedulable on resume.
    const schedulable = selectSchedulableTasks(result.tasks);
    expect(schedulable.map((task) => task.id)).toEqual(['r1']);
    expect(result.tasks.find((task) => task.id === 'p1')?.producedArtifactId).toBe('art-1');
  });
});

describe('OfficeEngagementRepository — audit trail', () => {
  const base: OfficeEngagement = {
    id: 'eng-1',
    projectId: 'proj-1',
    schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
    title: 'Encargo',
    brief: 'b',
    businessProjectIds: [],
    initiativeIds: [],
    priority: 'medium',
    status: 'in-progress',
    charter: {
      kind: 'new-solution',
      objectives: [], scope: [], outOfScope: [], constraints: [], regulatoryDrivers: [],
      deliverables: [], participantIds: [],
      coordinatorId: 'lucia', consolidatorId: 'alejandro',
      provenance: 'deterministic', proposedAt: '2026-08-26T00:00:00.000Z',
    },
    tasks: [],
    arbDecisions: [],
    budget: { ...DEFAULT_OFFICE_BUDGET },
    auditTrail: [],
    createdBy: SYSTEM_OFFICE_ACTOR,
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
  };

  it('stamps an entry with an actor and a timestamp', () => {
    const entry = buildAuditEntry('eng-1', 'run-started', 'arrancó');
    expect(entry.actor).toEqual(SYSTEM_OFFICE_ACTOR);
    expect(entry.timestamp).toBeTruthy();
    expect(entry.id).toMatch(/^audit_/);
  });

  it('appends without mutating the input engagement', () => {
    const snapshot = JSON.stringify(base);
    const next = withAuditEntry(base, 'run-started', 'arrancó');
    expect(JSON.stringify(base)).toBe(snapshot);
    expect(next.auditTrail).toHaveLength(1);
    expect(base.auditTrail).toHaveLength(0);
  });

  it('is append-only — earlier entries survive later ones', () => {
    const first = withAuditEntry(base, 'run-started', 'uno');
    const second = withAuditEntry(first, 'task-completed', 'dos');
    expect(second.auditTrail.map((entry) => entry.details)).toEqual(['uno', 'dos']);
  });
});

/**
 * `normalizeTask` rebuilds a task field by field, so anything it does not name
 * is dropped on every read. That is how a correlation feature can work
 * perfectly in memory and vanish on exactly the reload it exists to survive —
 * an engagement resumes rather than restarts, so the reload is the normal case.
 */
describe('la correlación sobrevive a la lectura', () => {
  const withRun = () => storedEngagement({
    currentRunId: 'run-7',
    tasks: [{
      id: 't1',
      assigneeId: 'felipe',
      kind: 'produce-artifact',
      status: 'completed',
      createdAt: '2026-08-26T10:00:00.000Z',
      runId: 'run-7',
      traceIds: ['agent-trace-1', 'agent-trace-2'],
    }],
    auditTrail: [{ id: 'a1', engagementId: 'eng-1', runId: 'run-7', action: 'task-completed', details: 'ok' }],
  });

  it('conserva runId, createdAt y las trazas de cada tarea', () => {
    const engagement = normalizeEngagement(withRun(), 'proj-1');
    expect(engagement).not.toBeNull();
    const task = engagement?.tasks[0];
    expect(task?.runId).toBe('run-7');
    expect(task?.createdAt).toBe('2026-08-26T10:00:00.000Z');
    expect(task?.traceIds).toEqual(['agent-trace-1', 'agent-trace-2']);
  });

  it('conserva el run en curso del encargo', () => {
    expect(normalizeEngagement(withRun(), 'proj-1')?.currentRunId).toBe('run-7');
  });

  it('lee un encargo anterior a la correlación sin inventarle un run', () => {
    const legacy = normalizeEngagement(storedEngagement(), 'proj-1');
    expect(legacy?.currentRunId).toBeUndefined();
    for (const task of legacy?.tasks ?? []) {
      expect(task.runId).toBeUndefined();
      expect(task.traceIds).toBeUndefined();
    }
  });
});

/** El rastro toma el run del encargo, no de quien llama: ocho sitios lo escriben. */
describe('withAuditEntry estampa el run en curso', () => {
  it('sella la entrada con el run del encargo', () => {
    const base = normalizeEngagement(storedEngagement({ currentRunId: 'run-9' }), 'proj-1') as OfficeEngagement;
    const next = withAuditEntry(base, 'task-started', 'arranca');
    expect(next.auditTrail[next.auditTrail.length - 1].runId).toBe('run-9');
  });

  it('no inventa un run cuando el encargo no está ejecutándose', () => {
    const base = normalizeEngagement(storedEngagement(), 'proj-1') as OfficeEngagement;
    const next = withAuditEntry(base, 'engagement-created', 'alta');
    expect(next.auditTrail[next.auditTrail.length - 1].runId).toBeUndefined();
  });
});

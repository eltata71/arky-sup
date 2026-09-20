import { describe, expect, it, vi } from 'vitest';
import {
  runEngagement,
  type OfficeRunnerPorts,
} from '../../services/architectureOffice/OfficeEngagementRunner';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
  type OfficeTask,
  type OfficeTaskReview,
} from '../../services/architectureOffice/OfficeTypes';
import type { OfficeAgentId } from '../../services/architectureOffice/officeAgentPersonas';
import type { PersistenceResult, PersistenceStatus } from '../../services/persistence';

const task = (overrides: Partial<OfficeTask> & Pick<OfficeTask, 'id' | 'kind' | 'assigneeId'>): OfficeTask => ({
  engagementId: 'eng-1',
  title: overrides.id,
  objective: '',
  dependsOn: [],
  acceptanceCriteria: [],
  status: overrides.dependsOn && overrides.dependsOn.length > 0 ? 'pending' : 'ready',
  attempts: 0,
  maxAttempts: 2,
  ...overrides,
});

const engagementWith = (tasks: OfficeTask[], maxAiCalls = DEFAULT_OFFICE_BUDGET.maxAiCalls): OfficeEngagement => ({
  id: 'eng-1',
  projectId: 'proj-1',
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: 'Encargo de prueba',
  brief: 'brief',
  businessProjectIds: [],
  initiativeIds: [],
  priority: 'medium' as const,
  status: 'in-progress',
  charter: {
    kind: 'new-solution',
    objectives: [],
    scope: [],
    outOfScope: [],
    constraints: [],
    regulatoryDrivers: [],
    deliverables: [],
    participantIds: [],
    coordinatorId: 'lucia',
    consolidatorId: 'alejandro',
    provenance: 'deterministic',
    proposedAt: '2026-08-26T00:00:00.000Z',
  },
  tasks,
  arbDecisions: [],
  budget: { maxAiCalls, consumedAiCalls: 0 },
  auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
});

const approval = (reviewerId: OfficeAgentId): OfficeTaskReview => ({
  reviewerId,
  verdict: 'approved',
  findings: [],
  summary: 'Cumple los criterios.',
  decidedAt: '2026-08-26T00:00:00.000Z',
});

const changesRequested = (reviewerId: OfficeAgentId): OfficeTaskReview => ({
  reviewerId,
  verdict: 'changes-requested',
  findings: [{ severity: 'high', message: 'Falta la vista de despliegue.' }],
  summary: 'Faltan elementos obligatorios.',
  decidedAt: '2026-08-26T00:00:00.000Z',
});

/**
 * Una escritura confirmada, que es lo que el runner espera por defecto.
 *
 * Existe porque el puerto dejó de poder decir `undefined`: un `persist` que no
 * puede reportar un fallo obliga al runner a suponer que todo se guardó, que es
 * exactamente lo que hacía.
 */
const persisted = (engagement: OfficeEngagement): PersistenceResult<OfficeEngagement> => ({
  status: 'success',
  success: true,
  operationId: 'test-persist',
  target: 'supabase',
  data: engagement,
});

const makePorts = (overrides: Partial<OfficeRunnerPorts> = {}): OfficeRunnerPorts => ({
  produceArtifact: vi.fn(async () => ({ status: 'success' as const, artifactId: 'art-1', versionGroupId: 'grp-1' })),
  reviewArtifact: vi.fn(async (current: OfficeTask) => approval(current.assigneeId)),
  consolidate: vi.fn(async () => ({ status: 'success' as const, summary: 'Ready.' })),
  persist: vi.fn(async (engagement: OfficeEngagement) => persisted(engagement)),
  ...overrides,
});

describe('OfficeEngagementRunner', () => {
  it('runs a produce → review → consolidate chain to completion', async () => {
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
      task({ id: 'c1', kind: 'consolidate', assigneeId: 'alejandro', dependsOn: ['r1'] }),
    ];
    const ports = makePorts();

    const result = await runEngagement(engagementWith(tasks), ports);

    expect(result.status).toBe('completed');
    expect(result.engagement.status).toBe('awaiting-arb');
    expect(result.engagement.tasks.every((item) => item.status === 'completed')).toBe(true);
    expect(ports.produceArtifact).toHaveBeenCalledTimes(1);
    expect(ports.consolidate).toHaveBeenCalledTimes(1);
  });

  it('respects topological order — a dependent task never runs before its dependency', async () => {
    const order: string[] = [];
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
      task({ id: 'p2', kind: 'produce-artifact', assigneeId: 'mauricio', reviewerId: 'elena', dependsOn: ['r1'] }),
      task({ id: 'r2', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p2'], reviewsTaskId: 'p2' }),
    ];
    const ports = makePorts({
      produceArtifact: vi.fn(async (current: OfficeTask) => {
        order.push(current.id);
        return { status: 'success' as const, artifactId: 'a', versionGroupId: 'g' };
      }),
      reviewArtifact: vi.fn(async (current: OfficeTask) => {
        order.push(current.id);
        return approval(current.assigneeId);
      }),
    });

    await runEngagement(engagementWith(tasks), ports);

    expect(order).toEqual(['p1', 'r1', 'p2', 'r2']);
  });

  it('persists after every transition so a reload can resume', async () => {
    const persist = vi.fn(async (engagement: OfficeEngagement) => persisted(engagement));
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
    ];

    await runEngagement(engagementWith(tasks), makePorts({ persist }));

    // start + per-batch start + per-batch settle + final: several saves, not one.
    expect(persist.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('resumes an engagement whose first task already completed', async () => {
    const produceArtifact = vi.fn(async () => ({ status: 'success' as const, artifactId: 'a', versionGroupId: 'g' }));
    const tasks = [
      task({
        id: 'p1',
        kind: 'produce-artifact',
        assigneeId: 'felipe',
        reviewerId: 'elena',
        status: 'completed',
        attempts: 1,
        producedArtifactId: 'art-existing',
      }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
    ];

    const result = await runEngagement(engagementWith(tasks), makePorts({ produceArtifact }));

    expect(produceArtifact).not.toHaveBeenCalled();
    expect(result.status).toBe('completed');
    expect(result.engagement.tasks.find((item) => item.id === 'p1')?.producedArtifactId).toBe('art-existing');
  });

  it('re-runs production once when the reviewer asks for changes, then converges', async () => {
    let reviewCount = 0;
    const produceArtifact = vi.fn(async () => ({ status: 'success' as const, artifactId: 'a', versionGroupId: 'g' }));
    const reviewArtifact = vi.fn(async (current: OfficeTask) => {
      reviewCount += 1;
      return reviewCount === 1 ? changesRequested(current.assigneeId) : approval(current.assigneeId);
    });
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena', maxAttempts: 2 }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
    ];

    const result = await runEngagement(engagementWith(tasks), makePorts({ produceArtifact, reviewArtifact }));

    expect(produceArtifact).toHaveBeenCalledTimes(2);
    expect(reviewArtifact).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('completed');
    expect(result.engagement.tasks.find((item) => item.id === 'p1')?.status).toBe('completed');
  });

  it('carries the reviewer findings into the retry', async () => {
    let reviewCount = 0;
    const seenFindings: unknown[] = [];
    const produceArtifact = vi.fn(async (current: OfficeTask) => {
      seenFindings.push(current.carriedFindings);
      return { status: 'success' as const, artifactId: 'a', versionGroupId: 'g' };
    });
    const reviewArtifact = vi.fn(async (current: OfficeTask) => {
      reviewCount += 1;
      return reviewCount === 1 ? changesRequested(current.assigneeId) : approval(current.assigneeId);
    });
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena', maxAttempts: 2 }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
    ];

    await runEngagement(engagementWith(tasks), makePorts({ produceArtifact, reviewArtifact }));

    expect(seenFindings[0]).toBeUndefined();
    expect(seenFindings[1]).toEqual([{ severity: 'high', message: 'Falta la vista de despliegue.' }]);
  });

  it('stops the reflection loop at maxAttempts instead of looping forever', async () => {
    const produceArtifact = vi.fn(async () => ({ status: 'success' as const, artifactId: 'a', versionGroupId: 'g' }));
    const reviewArtifact = vi.fn(async (current: OfficeTask) => changesRequested(current.assigneeId));
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena', maxAttempts: 2 }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
    ];

    const result = await runEngagement(engagementWith(tasks), makePorts({ produceArtifact, reviewArtifact }));

    expect(produceArtifact).toHaveBeenCalledTimes(2);
    const producer = result.engagement.tasks.find((item) => item.id === 'p1');
    expect(producer?.status).toBe('failed');
    expect(producer?.error).toMatch(/Revisión no superada/);
    expect(result.status).toBe('partial');
  });

  it('isolates a failing task without aborting its siblings', async () => {
    const produceArtifact = vi.fn(async (current: OfficeTask) => (
      current.id === 'p1'
        ? { status: 'failed' as const, message: 'sin contenido utilizable' }
        : { status: 'success' as const, artifactId: 'a', versionGroupId: 'g' }
    ));
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }),
      task({ id: 'p2', kind: 'produce-artifact', assigneeId: 'mauricio', reviewerId: 'elena' }),
      task({ id: 'r2', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p2'], reviewsTaskId: 'p2' }),
    ];

    const result = await runEngagement(engagementWith(tasks), makePorts({ produceArtifact }));

    expect(result.engagement.tasks.find((item) => item.id === 'p1')?.status).toBe('failed');
    expect(result.engagement.tasks.find((item) => item.id === 'p2')?.status).toBe('completed');
    expect(result.engagement.tasks.find((item) => item.id === 'r2')?.status).toBe('completed');
    expect(result.status).toBe('partial');
  });

  it('treats a thrown port error as a task failure, not a crash', async () => {
    const produceArtifact = vi.fn(async () => { throw new Error('proveedor caído'); });
    const tasks = [task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' })];

    const result = await runEngagement(engagementWith(tasks), makePorts({ produceArtifact }));

    expect(result.engagement.tasks[0].status).toBe('failed');
    expect(result.engagement.tasks[0].error).toBe('proveedor caído');
  });

  it('blocks the engagement when a dependency never completes', async () => {
    const produceArtifact = vi.fn(async () => ({ status: 'failed' as const, message: 'falló' }));
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
    ];

    const result = await runEngagement(engagementWith(tasks), makePorts({ produceArtifact }));

    expect(result.status).toBe('blocked');
    expect(result.engagement.status).toBe('blocked');
    expect(result.engagement.tasks.find((item) => item.id === 'r1')?.status).toBe('pending');
  });

  it('stops when the AI budget is exhausted', async () => {
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }),
      task({ id: 'p2', kind: 'produce-artifact', assigneeId: 'mauricio', reviewerId: 'elena' }),
      task({ id: 'p3', kind: 'produce-artifact', assigneeId: 'ricardo', reviewerId: 'elena' }),
    ];
    const produceArtifact = vi.fn(async () => ({
      status: 'success' as const, artifactId: 'a', versionGroupId: 'g', aiCalls: 2,
    }));

    const result = await runEngagement(
      engagementWith(tasks, 2),
      makePorts({ produceArtifact }),
      { maxConcurrency: 1 },
    );

    expect(result.status).toBe('budget-exhausted');
    expect(result.engagement.status).toBe('blocked');
    expect(produceArtifact).toHaveBeenCalledTimes(1);
    expect(result.engagement.auditTrail.some((entry) => entry.action === 'budget-exhausted')).toBe(true);
  });

  it('honours an abort signal and marks the remaining work cancelled', async () => {
    const controller = new AbortController();
    const produceArtifact = vi.fn(async () => {
      controller.abort();
      return { status: 'success' as const, artifactId: 'a', versionGroupId: 'g' };
    });
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
    ];

    const result = await runEngagement(
      engagementWith(tasks),
      makePorts({ produceArtifact }),
      { signal: controller.signal, maxConcurrency: 1 },
    );

    expect(result.status).toBe('cancelled');
    expect(result.engagement.tasks.find((item) => item.id === 'r1')?.status).toBe('cancelled');
  });

  it('never schedules more tasks in one batch than the concurrency limit', async () => {
    let peak = 0;
    let live = 0;
    const produceArtifact = vi.fn(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await Promise.resolve();
      live -= 1;
      return { status: 'success' as const, artifactId: 'a', versionGroupId: 'g' };
    });
    const tasks = (['felipe', 'mauricio', 'ricardo', 'natalia', 'sofia'] as OfficeAgentId[]).map((assigneeId, index) =>
      task({ id: `p${index}`, kind: 'produce-artifact', assigneeId, reviewerId: 'elena' }));

    await runEngagement(engagementWith(tasks), makePorts({ produceArtifact }), { maxConcurrency: 2 });

    expect(peak).toBeLessThanOrEqual(2);
    expect(produceArtifact).toHaveBeenCalledTimes(5);
  });

  /**
   * The ceiling test above proves nothing runs *too* wide. This one proves work
   * runs wide at all: a runner that executed everything sequentially would pass
   * `peak <= 2` and fail here. Both halves are needed — a bound with no floor
   * is satisfied by doing nothing in parallel.
   */
  it('actually runs independent tasks in parallel, not just within the limit', async () => {
    let live = 0;
    let peak = 0;
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });

    const produceArtifact = vi.fn(async () => {
      live += 1;
      peak = Math.max(peak, live);
      // Hold every task open until the batch has been dispatched, so `peak`
      // measures real overlap rather than the scheduler's speed.
      if (live >= 2 && release) release();
      await gate;
      live -= 1;
      return { status: 'success' as const, artifactId: 'a', versionGroupId: 'g' };
    });

    const tasks = (['felipe', 'mauricio', 'ricardo'] as OfficeAgentId[]).map((assigneeId, index) =>
      task({ id: `p${index}`, kind: 'produce-artifact', assigneeId, reviewerId: 'elena' }));

    await runEngagement(engagementWith(tasks), makePorts({ produceArtifact }), { maxConcurrency: 3 });

    expect(peak).toBeGreaterThanOrEqual(2);
    expect(produceArtifact).toHaveBeenCalledTimes(3);
  });

  /**
   * The agent's card lets an organisation set an agent's capacity, and the
   * runner used to read the value the product ships with instead — so raising
   * Elena to 3 changed a number on a screen and nothing else.
   */
  it('honours the capacity configured on the agent card, not the shipped default', async () => {
    let live = 0;
    let peak = 0;
    const produceArtifact = vi.fn(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return { status: 'success' as const, artifactId: 'a', versionGroupId: 'g' };
    });

    // Three tasks for one persona whose shipped ceiling is 2, configured to 1.
    const tasks = [0, 1, 2].map((index) =>
      task({ id: `p${index}`, kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }));

    await runEngagement(engagementWith(tasks), makePorts({ produceArtifact }), {
      maxConcurrency: 3,
      agentConcurrency: new Map([['felipe', 1]]),
    });

    expect(peak).toBe(1);
    expect(produceArtifact).toHaveBeenCalledTimes(3);
  });

  it('falls back to the persona default when the card configures nothing', async () => {
    let live = 0;
    let peak = 0;
    const produceArtifact = vi.fn(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return { status: 'success' as const, artifactId: 'a', versionGroupId: 'g' };
    });
    const tasks = [0, 1, 2].map((index) =>
      task({ id: `p${index}`, kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }));

    await runEngagement(engagementWith(tasks), makePorts({ produceArtifact }), {
      maxConcurrency: 3,
      agentConcurrency: new Map(),
    });

    // Felipe ships with `maxConcurrentTasks: 2`.
    expect(peak).toBe(2);
  });

  /*
   * Estas cuatro sustituyen a una que se llamaba «keeps running when
   * persistence fails» y afirmaba exactamente el defecto: que un fallo al
   * guardar el punto de recuperación no detenía nada y la ejecución terminaba
   * en `completed`.
   *
   * El motivo por el que aquello parecía razonable está en el comentario que
   * acompañaba al `catch` vacío: no tirar trabajo ya generado. Es correcto, y
   * se conserva abajo. Lo que no se sigue de ahí es seguir **programando** más
   * tareas: eso gasta llamadas de IA cuyo resultado nadie va a guardar y deja
   * un encargo que, al recargar, se reanuda desde mucho antes de donde el
   * usuario lo vio terminar.
   */
  const failingPersist = (status: PersistenceStatus) => ({
    status,
    success: false as const,
    operationId: 'test-persist',
    target: 'supabase' as const,
    message: `fallo simulado: ${status}`,
  });

  it('se detiene cuando el punto de recuperación no se guarda', async () => {
    const persist = vi.fn(async () => failingPersist('conflict'));
    const tasks = [task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' })];

    const result = await runEngagement(engagementWith(tasks), makePorts({ persist }));

    expect(result.status).toBe('not-persisted');
    expect(result.persistence).toBe('conflict');
    expect(result.message).toContain('Recarga');
  });

  it('trata un puerto que lanza como el fallo que es', async () => {
    const persist = vi.fn(async () => { throw new Error('la red se cayó'); });
    const tasks = [task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' })];

    const result = await runEngagement(engagementWith(tasks), makePorts({ persist }));

    expect(result.status).toBe('not-persisted');
    expect(result.persistence).toBe('failed');
  });

  it('sigue sin conexión, porque el espejo local es la degradación prevista', async () => {
    // `offline` es el único estado que no detiene: el repositorio conserva el
    // encargo en el espejo local y eso es precisamente para lo que existe.
    const persist = vi.fn(async () => failingPersist('offline'));
    const tasks = [task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' })];

    const result = await runEngagement(engagementWith(tasks), makePorts({ persist }));

    expect(result.status).toBe('completed');
    expect(result.engagement.tasks[0].status).toBe('completed');
  });

  it('conserva el trabajo ya generado cuando se detiene', async () => {
    // La mitad legítima de la prueba que esto sustituye: lo generado no se
    // tira. Guarda bien hasta que la primera tarea termina y falla después.
    let calls = 0;
    const persist = vi.fn(async (engagement: OfficeEngagement) => {
      calls += 1;
      return calls <= 2 ? persisted(engagement) : failingPersist('permission-denied');
    });
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
    ];

    const result = await runEngagement(engagementWith(tasks), makePorts({ persist }));

    expect(result.status).toBe('not-persisted');
    expect(result.persistence).toBe('permission-denied');
    // La primera tarea corrió y su estado viaja en el resultado.
    expect(result.engagement.tasks[0].status).not.toBe('pending');
  });

  it('se queda con el encargo que devolvió la escritura, no con el que envió', async () => {
    // Es lo que mantiene el testigo de revisión al día. El runner escribe en
    // cada transición, así que quedarse con lo enviado convertiría la segunda
    // escritura en un conflicto garantizado.
    const persist = vi.fn(async (engagement: OfficeEngagement) => persisted({
      ...engagement,
      revision: (engagement.revision ?? 0) + 1,
    }));
    const tasks = [task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' })];

    await runEngagement(engagementWith(tasks), makePorts({ persist }));

    const seen = persist.mock.calls.map(([engagement]) => engagement.revision);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBe(1);
    expect(seen[seen.length - 1]).toBe(seen.length - 1);
  });

  it('records an auditable trail of who did what', async () => {
    const tasks = [
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena' }),
      task({ id: 'r1', kind: 'review-artifact', assigneeId: 'elena', dependsOn: ['p1'], reviewsTaskId: 'p1' }),
    ];

    const result = await runEngagement(engagementWith(tasks), makePorts());

    const actions = result.engagement.auditTrail.map((entry) => entry.action);
    expect(actions).toContain('run-started');
    expect(actions).toContain('task-started');
    expect(actions).toContain('task-completed');
    expect(actions).toContain('submitted-to-arb');
    expect(result.engagement.auditTrail.every((entry) => Boolean(entry.timestamp && entry.actor))).toBe(true);
  });
});

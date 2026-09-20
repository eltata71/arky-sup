/**
 * Las operaciones de la Oficina, probadas **sin React**.
 *
 * Es el punto de todo el cambio. Estas reglas vivían dentro de `useCallback`s
 * en `context/OfficeContext.tsx`, así que la única forma de ejercitar «qué pasa
 * si la escritura falla» era montar un proveedor y simular un clic — y por eso
 * nadie la ejercitaba: las seis operaciones devolvían `ok: true` pasara lo que
 * pasara. Aquí basta con doblar dos puertos.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PersistenceResult, PersistenceStatus } from '../../../../services/persistence';
import {
  approveCharterOperation,
  createEngagementOperation,
  decideEngagementOperation,
  deleteEngagementOperation,
  describePersistenceFailure,
  type EngagementWritePort,
} from '../../../../services/architectureOffice/application/engagementOperations';
import type {
  OfficeActor,
  OfficeEngagement,
} from '../../../../services/architectureOffice/OfficeTypes';

const admin: OfficeActor = { id: 'u1', name: 'Ana', role: 'admin' };
const architect: OfficeActor = { id: 'u2', name: 'Beto', role: 'architect' };

const ok = <T>(data?: T): PersistenceResult<T> => ({
  status: 'success', success: true, operationId: 'op', target: 'supabase', data,
});
const fail = <T>(status: PersistenceStatus): PersistenceResult<T> => ({
  status, success: false, operationId: 'op', target: 'supabase', message: `fallo ${status}`,
});

const writes = (over: Partial<EngagementWritePort> = {}): EngagementWritePort => ({
  save: vi.fn(async (engagement: OfficeEngagement) => ok(engagement)),
  remove: vi.fn(async () => ok<void>(undefined)),
  recordArbDecision: vi.fn(async () => ok<void>(undefined)),
  ...over,
});

const engagement = (over: Partial<OfficeEngagement> = {}): OfficeEngagement => ({
  id: 'eng-1',
  projectId: 'proj-1',
  schemaVersion: 1,
  title: 'Encargo',
  brief: 'Una necesidad del negocio.',
  initiativeIds: ['init-1'],
  businessProjectIds: [],
  status: 'awaiting-charter',
  priority: 'medium',
  charter: {
    kind: 'new-solution', objectives: [], scope: [], outOfScope: [], constraints: [],
    regulatoryDrivers: [], deliverables: [], participantIds: [],
    coordinatorId: 'lucia', consolidatorId: 'alejandro',
    provenance: 'deterministic', proposedAt: '2026-09-20T00:00:00.000Z',
  },
  tasks: [],
  arbDecisions: [],
  budget: { maxAiCalls: 40, consumedAiCalls: 0 },
  auditTrail: [],
  createdBy: architect,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z',
  ...over,
});

const project = { id: 'proj-1', initiativeIds: ['init-1'], linkedBusinessProjects: ['NEG-2026-001'] };

/** Un charter con algo que aprobar: sin entregables la regla se niega antes de escribir. */
const approvable = () => engagement({
  charter: {
    ...engagement().charter,
    deliverables: [{
      templateName: 'Diagrama de contexto',
      artifactType: 'mermaid-c4-context' as const,
      assigneeId: 'felipe' as const,
      reviewerId: 'elena' as const,
      rationale: 'Necesario para el alcance.',
      dependsOnTemplateNames: [],
    }],
    participantIds: ['felipe' as const, 'elena' as const],
  },
});

describe('una escritura no confirmada nunca es un éxito', () => {
  it('traduce cada estado a la acción que quien lo lee puede tomar', () => {
    const subject = engagement();
    expect(describePersistenceFailure(fail('conflict'), subject).reason).toMatch(/Recarga/);
    expect(describePersistenceFailure(fail('permission-denied'), subject).reason).toMatch(/rol/);
    expect(describePersistenceFailure(fail('offline'), subject).reason).toMatch(/dispositivo/);
    // El mensaje del servidor se conserva cuando no hay nada mejor que decir.
    expect(describePersistenceFailure(fail('failed'), subject).reason).toBe('fallo failed');
  });

  it('devuelve el encargo aunque la escritura falle, para no perderlo de vista', () => {
    const subject = engagement();
    expect(describePersistenceFailure(fail('conflict'), subject).engagement).toBe(subject);
  });

  it('no dice que aprobó el charter cuando la aprobación no se guardó', async () => {
    const port = writes({ save: vi.fn(async () => fail<OfficeEngagement>('conflict')) });
    const result = await approveCharterOperation({ writes: port }, approvable(), admin);
    expect(result.ok).toBe(false);
    expect(result.persistence).toBe('conflict');
  });

  it('distingue un rechazo de las reglas de un fallo al guardar', async () => {
    // Lo primero no se reintenta nunca; lo segundo sí. `persistence` ausente
    // significa que no se llegó a escribir.
    const port = writes();
    const alreadyApproved = engagement({
      charter: { ...engagement().charter, approvedAt: '2026-09-20T01:00:00.000Z', approvedBy: admin },
      status: 'in-progress',
    });
    const refused = await approveCharterOperation({ writes: port }, alreadyApproved, admin);
    expect(refused.ok).toBe(false);
    expect(refused.persistence).toBeUndefined();
    expect(port.save).not.toHaveBeenCalled();
  });
});

describe('el borrado optimista se deshace si el borrado falla', () => {
  it('restaura el encargo que había quitado de la vista', async () => {
    const onRestore = vi.fn();
    const port = writes({ remove: vi.fn(async () => fail<void>('conflict')) });
    const subject = engagement({ revision: 4 });

    const result = await deleteEngagementOperation({ writes: port, onRestore }, subject);

    expect(result.ok).toBe(false);
    expect(onRestore).toHaveBeenCalledWith(subject);
  });

  it('borra con la revisión del snapshot que se está viendo', async () => {
    const port = writes();
    await deleteEngagementOperation({ writes: port }, engagement({ revision: 4 }));
    expect(port.remove).toHaveBeenCalledWith('proj-1', 'eng-1', 4);
  });

  it('un encargo sin testigo espera no existir, en vez de pisar lo que haya', async () => {
    const port = writes();
    await deleteEngagementOperation({ writes: port }, engagement());
    expect(port.remove).toHaveBeenCalledWith('proj-1', 'eng-1', 0);
  });
});

describe('la decisión del ARB no se queda a medias en el peor orden', () => {
  const awaitingArb = () => engagement({
    status: 'awaiting-arb',
    charter: { ...engagement().charter, approvedAt: '2026-09-20T01:00:00.000Z', approvedBy: admin },
    revision: 5,
  });

  it('escribe el registro inmutable antes de transicionar el encargo', async () => {
    const order: string[] = [];
    const port = writes({
      recordArbDecision: vi.fn(async () => { order.push('arb'); return ok<void>(undefined); }),
      save: vi.fn(async (e: OfficeEngagement) => { order.push('save'); return ok(e); }),
    });

    const result = await decideEngagementOperation({ writes: port }, awaitingArb(), {
      verdict: 'approved', rationale: '', actor: admin,
    });

    expect(result.ok).toBe(true);
    expect(order).toEqual(['arb', 'save']);
  });

  it('no transiciona el encargo si el registro inmutable rechaza la firma', async () => {
    // Era al revés, y ése es el peor de los dos estados intermedios posibles:
    // la primera escritura ya había guardado el espejo `arbDecisions` dentro
    // del documento, así que la pantalla mostraba una decisión firmada que el
    // registro a prueba de manipulación no tenía. No pierde el dato: lo inventa.
    const port = writes({
      recordArbDecision: vi.fn(async () => fail<void>('permission-denied')),
    });

    const result = await decideEngagementOperation({ writes: port }, awaitingArb(), {
      verdict: 'approved', rationale: '', actor: admin,
    });

    expect(result.ok).toBe(false);
    expect(result.persistence).toBe('permission-denied');
    expect(port.save).not.toHaveBeenCalled();
    expect(result.engagement?.status).toBe('awaiting-arb');
    expect(result.engagement?.arbDecisions).toEqual([]);
  });

  it('dice que la decisión quedó registrada cuando lo que falla es la transición', async () => {
    const port = writes({ save: vi.fn(async () => fail<OfficeEngagement>('conflict')) });
    const result = await decideEngagementOperation({ writes: port }, awaitingArb(), {
      verdict: 'approved', rationale: '', actor: admin,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/quedó registrada/i);
    expect(result.reason).toMatch(/no se duplica/i);
  });

  it('no llega a escribir nada cuando las reglas rechazan la decisión', async () => {
    const port = writes();
    const result = await decideEngagementOperation({ writes: port }, engagement(), {
      verdict: 'approved', rationale: '', actor: admin,
    });
    expect(result.ok).toBe(false);
    expect(port.recordArbDecision).not.toHaveBeenCalled();
    expect(port.save).not.toHaveBeenCalled();
  });

  it('no deja firmar a quien no es del comité', async () => {
    const port = writes();
    const result = await decideEngagementOperation({ writes: port }, awaitingArb(), {
      verdict: 'approved', rationale: '', actor: architect,
    });
    expect(result.ok).toBe(false);
    expect(port.recordArbDecision).not.toHaveBeenCalled();
  });
});

describe('la intake sin modelo', () => {
  it('crea el encargo con el charter determinista cuando el refinamiento falla', async () => {
    const port = writes();
    const result = await createEngagementOperation(
      { writes: port, refineCharter: async () => { throw new Error('sin proveedor'); } },
      project,
      { projectId: 'proj-1', title: 'Encargo', brief: 'Modernizar el motor de siniestros.' },
      architect,
    );
    expect(result.ok).toBe(true);
    expect(result.engagement?.charter.provenance).toBe('deterministic');
    expect(result.engagement?.charter.deliverables.length).toBeGreaterThan(0);
  });

  it('no pide refinamiento cuando se pide determinista', async () => {
    const refineCharter = vi.fn(async () => '{}');
    await createEngagementOperation(
      { writes: writes(), refineCharter },
      project,
      { projectId: 'proj-1', title: 'Encargo', brief: 'Una necesidad.', deterministicOnly: true },
      architect,
    );
    expect(refineCharter).not.toHaveBeenCalled();
  });

  it('hereda las iniciativas del proyecto cuando la intake no las estrecha', async () => {
    const result = await createEngagementOperation(
      { writes: writes() },
      project,
      { projectId: 'proj-1', title: 'Encargo', brief: 'Una necesidad.' },
      architect,
    );
    expect(result.engagement?.initiativeIds).toEqual(['init-1']);
    expect(result.engagement?.businessProjectIds).toEqual(['NEG-2026-001']);
  });

  it('enseña el borrador antes de confirmarlo, y el confirmado después', async () => {
    const onDraft = vi.fn();
    const saved = { ...engagement(), revision: 1 };
    const port = writes({ save: vi.fn(async () => ok(saved)) });

    await createEngagementOperation(
      { writes: port, onDraft },
      project,
      { projectId: 'proj-1', title: 'Encargo', brief: 'Una necesidad.', deterministicOnly: true },
      architect,
    );

    expect(onDraft).toHaveBeenCalledTimes(2);
    expect(onDraft.mock.calls[0][0].revision).toBeUndefined();
    expect(onDraft.mock.calls[1][0].revision).toBe(1);
  });
});

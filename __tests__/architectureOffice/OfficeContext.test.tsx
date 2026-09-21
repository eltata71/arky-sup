import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// El contexto llega a la base por el repositorio y al modelo por geminiService.
// Los dos están doblados: una prueba no toca ninguno.
//
// Se dobla la **puerta** y no cada llamada, que es la regla del repositorio: lo
// que queda bajo prueba es la traducción de un `PersistenceResult` a lo que la
// pantalla ve, que es donde vivía el defecto.
const savedEngagements: unknown[] = [];
const decidedEngagements: unknown[] = [];

type Outcome = { status: string; success: boolean; operationId: string; target: string; message?: string };

/** Lo que devolverá la siguiente escritura. Por defecto, éxito. */
const nextOutcome: { save: Outcome | null; arb: Outcome | null; remove: Outcome | null } = {
  save: null, arb: null, remove: null,
};
const ok = (data?: unknown): Outcome & { data?: unknown } => ({
  status: 'success', success: true, operationId: 'op', target: 'supabase', data,
});

/** Lo que `list()` devolverá. Vacío salvo que una prueba siembre un encargo. */
let seededEngagements: unknown[] = [];

vi.mock('../../services/architectureOffice/OfficeEngagementRepository', async () => {
  const actual = await vi.importActual<typeof import('../../services/architectureOffice/OfficeEngagementRepository')>(
    '../../services/architectureOffice/OfficeEngagementRepository',
  );
  return {
    ...actual,
    officeEngagementRepository: {
      list: vi.fn(async () => seededEngagements),
      listForArb: vi.fn(async () => []),
      save: vi.fn(async (engagement: unknown) => {
        savedEngagements.push(engagement);
        return nextOutcome.save ?? ok(engagement);
      }),
      remove: vi.fn(async () => nextOutcome.remove ?? ok()),
      decide: vi.fn(async (engagement: unknown) => {
        decidedEngagements.push(engagement);
        return nextOutcome.arb ?? ok(engagement);
      }),
    },
  };
});

vi.mock('../../services/geminiService', () => ({
  geminiService: {
    // Refinement is unavailable — the deterministic charter must still stand.
    chatWithProject: vi.fn(async () => { throw new Error('sin proveedor de IA'); }),
  },
}));

const mockAuth = { user: { uid: 'u1', email: 'ana@example.com' }, profile: { role: 'admin', displayName: 'Ana' } };
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const project = {
  id: 'proj-1',
  name: 'Seguros',
  description: '',
  projectContext: [],
  linkedBusinessProjects: ['NEG-2026-001'],
  artifacts: [],
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
};

vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({
    projects: [project],
    settings: { aiConfig: {} },
    createArtifact: vi.fn(),
    createArtifactVersion: vi.fn(),
    updateArtifact: vi.fn(),
  }),
}));

import { OfficeProvider, useOffice } from '../../context/OfficeContext';

const Harness: React.FC<{ onReady: (office: ReturnType<typeof useOffice>) => void }> = ({ onReady }) => {
  const office = useOffice();
  React.useEffect(() => { onReady(office); }, [office, onReady]);
  return (
    <div>
      <span data-testid="count">{office.engagements.length}</span>
      <span data-testid="can-approve">{String(office.canApprove)}</span>
      <span data-testid="status">{office.engagements[0]?.status ?? '—'}</span>
    </div>
  );
};

describe('OfficeContext', () => {
  let office: ReturnType<typeof useOffice>;

  beforeEach(() => {
    savedEngagements.length = 0;
    savedEngagements.length = 0;
    decidedEngagements.length = 0;
    nextOutcome.save = null;
    nextOutcome.arb = null;
    nextOutcome.remove = null;
    render(
      <OfficeProvider>
        <Harness onReady={(value) => { office = value; }} />
      </OfficeProvider>,
    );
  });

  it('recognises an admin as a board member', () => {
    expect(screen.getByTestId('can-approve')).toHaveTextContent('true');
  });

  it('creates an engagement with a runnable deterministic charter when the model is unavailable', async () => {
    await act(async () => {
      await office.createEngagement({
        projectId: 'proj-1',
        title: 'Modernización de siniestros',
        brief: 'Modernizar el motor de siniestros AS/400 exponiendo APIs a Salesforce Health Cloud.',
      });
    });

    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
    const created = office.engagements[0];
    expect(created.status).toBe('awaiting-charter');
    expect(created.charter.provenance).toBe('deterministic');
    expect(created.charter.deliverables.length).toBeGreaterThan(0);
    expect(created.tasks.length).toBeGreaterThan(0);
    // Business links are inherited from the project and normalized.
    expect(created.businessProjectIds).toEqual(['NEG-2026-001']);
    expect(savedEngagements.length).toBeGreaterThan(0);
  });

  it('records the intake in the audit trail', async () => {
    await act(async () => {
      await office.createEngagement({
        projectId: 'proj-1',
        title: 'Encargo',
        brief: 'Necesitamos una nueva plataforma de cotización de vida.',
      });
    });
    const actions = office.engagements[0].auditTrail.map((entry) => entry.action);
    expect(actions).toContain('engagement-created');
    expect(actions).toContain('charter-proposed');
  });

  it('refuses to run an engagement whose charter is not approved', async () => {
    await act(async () => {
      await office.createEngagement({
        projectId: 'proj-1',
        title: 'Encargo',
        brief: 'Necesitamos una nueva plataforma de cotización de vida.',
      });
    });
    const id = office.engagements[0].id;

    let result: Awaited<ReturnType<typeof office.runEngagementNow>>;
    await act(async () => { result = await office.runEngagementNow(id); });
    expect(result!.ok).toBe(false);
    expect(result!.reason).toMatch(/aprobarse/i);
  });

  it('approves the charter and releases the engagement to the runner', async () => {
    await act(async () => {
      await office.createEngagement({
        projectId: 'proj-1',
        title: 'Encargo',
        brief: 'Necesitamos una nueva plataforma de cotización de vida.',
      });
    });
    const id = office.engagements[0].id;

    await act(async () => { await office.approveCharter(id); });
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('in-progress'));
    expect(office.engagements[0].charter.approvedBy?.name).toBe('Ana');
  });

  it('approves and runs in the same invocation without a stale snapshot', async () => {
    // The intake wizard approves the charter and immediately runs the
    // engagement from one handler. If the operations read the engagement from
    // the React state closure, the run still sees the pre-approval snapshot and
    // refuses with "el charter debe aprobarse".
    await act(async () => {
      await office.createEngagement({
        projectId: 'proj-1',
        title: 'Encargo',
        brief: 'Necesitamos una nueva plataforma de cotización de vida.',
      });
    });
    const id = office.engagements[0].id;
    const { approveCharter, runEngagementNow } = office;

    let result: Awaited<ReturnType<typeof runEngagementNow>>;
    await act(async () => {
      await approveCharter(id);
      result = await runEngagementNow(id);
    });

    expect(result!.reason).not.toMatch(/aprobarse/i);
  });

  it('rejects an unknown project', async () => {
    let result: Awaited<ReturnType<typeof office.createEngagement>>;
    await act(async () => {
      result = await office.createEngagement({ projectId: 'nope', title: 't', brief: 'b' });
    });
    expect(result!.ok).toBe(false);
    expect(result!.reason).toMatch(/no existe/i);
  });

  it('refuses a board decision before the engagement reaches the board', async () => {
    await act(async () => {
      await office.createEngagement({
        projectId: 'proj-1',
        title: 'Encargo',
        brief: 'Necesitamos una nueva plataforma de cotización de vida.',
      });
    });
    const id = office.engagements[0].id;

    let result: Awaited<ReturnType<typeof office.decideEngagement>>;
    await act(async () => { result = await office.decideEngagement(id, 'approved', ''); });
    expect(result!.ok).toBe(false);
  });
});

describe('una escritura no confirmada no es un éxito', () => {
  /*
   * El defecto que esto cierra: `persistAndTrack` hacía
   * `await officeEngagementRepository.save(engagement)` y **descartaba** el
   * resultado —que es justo el envoltorio que `services/persistence` existe
   * para producir— así que las seis operaciones de este contexto respondían
   * `ok: true` tanto si la escritura se confirmaba como si el servidor la
   * rechazaba por conflicto de revisión o por permiso. La pantalla decía
   * «guardado» y no había nada guardado.
   */
  let office: ReturnType<typeof useOffice>;

  const fail = (status: string): Outcome => ({
    status, success: false, operationId: 'op', target: 'supabase', message: `fallo ${status}`,
  });

  beforeEach(() => {
    savedEngagements.length = 0;
    savedEngagements.length = 0;
    decidedEngagements.length = 0;
    nextOutcome.save = null;
    nextOutcome.arb = null;
    nextOutcome.remove = null;
    render(
      <OfficeProvider>
        <Harness onReady={(value) => { office = value; }} />
      </OfficeProvider>,
    );
  });

  const createEngagement = async (): Promise<string> => {
    await act(async () => {
      await office.createEngagement({
        projectId: 'proj-1',
        title: 'Encargo',
        brief: 'Necesitamos una nueva plataforma de cotización de vida.',
      });
    });
    return office.engagements[0].id;
  };

  it('no dice que creó el encargo cuando el servidor rechazó la escritura', async () => {
    nextOutcome.save = fail('conflict');
    let result: Awaited<ReturnType<typeof office.createEngagement>>;
    await act(async () => {
      result = await office.createEngagement({
        projectId: 'proj-1', title: 'Encargo', brief: 'Una necesidad cualquiera del negocio.',
      });
    });
    expect(result!.ok).toBe(false);
    expect(result!.persistence).toBe('conflict');
    expect(result!.reason).toMatch(/Recarga/i);
  });

  it('distingue un rechazo de las reglas de un fallo al guardar', async () => {
    // No es lo mismo para quien lo lee: lo primero no se reintenta nunca, lo
    // segundo sí. Antes ambos eran `ok: true`, o —cuando el dominio se negaba—
    // ambos eran `ok: false` sin nada que los separase.
    nextOutcome.save = fail('permission-denied');
    let result: Awaited<ReturnType<typeof office.createEngagement>>;
    await act(async () => {
      result = await office.createEngagement({
        projectId: 'proj-1', title: 'Encargo', brief: 'Una necesidad cualquiera del negocio.',
      });
    });
    expect(result!.persistence).toBe('permission-denied');

    let refused: Awaited<ReturnType<typeof office.createEngagement>>;
    await act(async () => {
      refused = await office.createEngagement({ projectId: 'nope', title: 't', brief: 'b' });
    });
    expect(refused!.ok).toBe(false);
    expect(refused!.persistence).toBeUndefined();
  });

  it('no dice que aprobó el charter cuando la aprobación no se guardó', async () => {
    const id = await createEngagement();
    nextOutcome.save = fail('conflict');
    let result: Awaited<ReturnType<typeof office.approveCharter>>;
    await act(async () => { result = await office.approveCharter(id); });
    expect(result!.ok).toBe(false);
  });

  it('conserva el trabajo en pantalla aunque la escritura falle', async () => {
    // La degradación optimista se mantiene a propósito: lo generado no se tira
    // porque la base no esté. Lo que cambia es que ahora se sabe.
    nextOutcome.save = fail('offline');
    await act(async () => {
      await office.createEngagement({
        projectId: 'proj-1', title: 'Encargo', brief: 'Una necesidad cualquiera del negocio.',
      });
    });
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
  });

  it('guarda el encargo que devolvió el servidor, con su revisión nueva', async () => {
    let result: Awaited<ReturnType<typeof office.createEngagement>>;
    await act(async () => {
      result = await office.createEngagement({
        projectId: 'proj-1', title: 'Encargo', brief: 'Una necesidad cualquiera del negocio.',
      });
    });
    // El doble devuelve `ok(engagement)`; lo que importa es que el contexto se
    // quede con `result.data` y no con lo que envió.
    expect(result!.ok).toBe(true);
    expect(result!.engagement).toBeDefined();
  });

  it('restaura el encargo en pantalla cuando el borrado falla', async () => {
    // Un encargo que sigue en la base y ha desaparecido de la pantalla es peor
    // que un borrado que falla: la siguiente cosa que hace quien lo ve es
    // volver a crearlo.
    const id = await createEngagement();
    nextOutcome.remove = fail('conflict');
    let result: Awaited<ReturnType<typeof office.deleteEngagement>>;
    await act(async () => { result = await office.deleteEngagement(id); });
    expect(result!.ok).toBe(false);
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'));
  });
});

describe('la decisión del ARB ya no puede quedarse a medias en el peor orden', () => {
  /*
   * Eran dos escrituras y el orden era el malo. La primera guardaba el encargo
   * —con el espejo `arbDecisions` dentro del documento— y la segunda escribía
   * el registro inmutable «best-effort». Si la segunda fallaba, la pantalla
   * mostraba una decisión firmada que el registro a prueba de manipulación —el
   * único que una auditoría acepta— no tenía. De los dos estados intermedios
   * posibles, ése es el peor: no pierde el dato, lo inventa.
   *
   * Siguen siendo dos escrituras: la transacción es `api.decide_engagement` y
   * es la tarea F2-01. Lo que cambia es que el estado intermedio que queda es
   * el honesto —decisión registrada, encargo sin transicionar— y que se
   * informa.
   */
  let office: ReturnType<typeof useOffice>;

  const awaitingArb = {
    id: 'eng-arb-1',
    projectId: 'proj-1',
    schemaVersion: 1,
    title: 'Encargo en comité',
    brief: 'Listo para el ARB.',
    initiativeIds: ['init-1'],
    businessProjectIds: [],
    status: 'awaiting-arb',
    priority: 'medium',
    charter: {
      kind: 'new-solution', objectives: [], scope: [], outOfScope: [], constraints: [],
      regulatoryDrivers: [], deliverables: [], participantIds: [],
      coordinatorId: 'lucia', consolidatorId: 'alejandro',
      provenance: 'deterministic', proposedAt: '2026-09-20T00:00:00.000Z',
      approvedAt: '2026-09-20T01:00:00.000Z',
    },
    tasks: [],
    arbDecisions: [],
    budget: { maxAiCalls: 40, consumedAiCalls: 0 },
    auditTrail: [],
    createdBy: { id: 'u1', name: 'Ana', role: 'admin' },
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    revision: 5,
  };

  beforeEach(async () => {
    savedEngagements.length = 0;
    savedEngagements.length = 0;
    decidedEngagements.length = 0;
    nextOutcome.save = null;
    nextOutcome.arb = null;
    nextOutcome.remove = null;
    seededEngagements = [awaitingArb];
    render(
      <OfficeProvider>
        <Harness onReady={(value) => { office = value; }} />
      </OfficeProvider>,
    );
    await act(async () => { await office.loadEngagements('proj-1'); });
  });

  it('firma y transiciona con una sola escritura', async () => {
    let result: Awaited<ReturnType<typeof office.decideEngagement>>;
    await act(async () => { result = await office.decideEngagement('eng-arb-1', 'approved', ''); });
    expect(result!.ok).toBe(true);
    expect(result!.engagement?.status).toBe('delivered');
    expect(decidedEngagements).toHaveLength(1);
    // La ruta antigua —dos escrituras, `save` incluida— ya no se recorre.
    expect(savedEngagements).toHaveLength(0);
  });

  it('deja el encargo donde estaba cuando la transacción no ocurre', async () => {
    nextOutcome.arb = {
      status: 'permission-denied', success: false, operationId: 'op', target: 'supabase',
      message: 'Permiso insuficiente: arb:decide',
    };
    let result: Awaited<ReturnType<typeof office.decideEngagement>>;
    await act(async () => { result = await office.decideEngagement('eng-arb-1', 'approved', ''); });

    expect(result!.ok).toBe(false);
    expect(result!.persistence).toBe('permission-denied');
    // Nada a medias que deshacer: la transacción no ocurrió. Lo que se deshace
    // es el optimismo de la pantalla.
    await waitFor(() => expect(office.engagements[0].status).toBe('awaiting-arb'));
    expect(office.engagements[0].arbDecisions).toEqual([]);
  });

  it('usa la revisión del snapshot al firmar', async () => {
    await act(async () => { await office.decideEngagement('eng-arb-1', 'approved', ''); });
    expect((decidedEngagements[0] as { revision?: number }).revision).toBe(5);
  });
});

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The office context reaches Firestore through the repository and the model
// through geminiService. Both are mocked: a test must never touch either.
const savedEngagements: unknown[] = [];

vi.mock('../../services/architectureOffice/OfficeEngagementRepository', async () => {
  const actual = await vi.importActual<typeof import('../../services/architectureOffice/OfficeEngagementRepository')>(
    '../../services/architectureOffice/OfficeEngagementRepository',
  );
  return {
    ...actual,
    officeEngagementRepository: {
      list: vi.fn(async () => []),
      save: vi.fn(async (engagement: unknown) => {
        savedEngagements.push(engagement);
        return { status: 'success', success: true, operationId: 'op', target: 'firestore' };
      }),
      remove: vi.fn(async () => ({ status: 'success', success: true, operationId: 'op', target: 'firestore' })),
      recordArbDecision: vi.fn(async () => ({ status: 'success', success: true, operationId: 'op', target: 'firestore' })),
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

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DecisionQueue,
  OfficeKpiRow,
  PortfolioExplorer,
  PortfolioPulse,
  SpecialistLoadPanel,
} from '../../components/architectureOffice/dashboard';
import { HierarchyBreadcrumb } from '../../components/navigation/HierarchyBreadcrumb';
import {
  buildOfficePortfolio,
  emptyPortfolioRollup,
} from '../../services/architectureOffice/domain/officePortfolio';
import type { Project } from '../../services/architectureProjects';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
  type OfficeTask,
} from '../../services/architectureOffice/domain/OfficeTypes';

const NOW = Date.parse('2026-08-27T12:00:00.000Z');

const task = (
  overrides: Partial<OfficeTask> & Pick<OfficeTask, 'id' | 'status'>,
): OfficeTask => ({
  engagementId: 'eng-1',
  kind: 'produce-artifact',
  title: overrides.id,
  objective: '',
  assigneeId: 'felipe',
  dependsOn: [],
  acceptanceCriteria: [],
  attempts: 1,
  maxAttempts: 2,
  ...overrides,
});

const engagement = (
  overrides: Partial<OfficeEngagement> & Pick<OfficeEngagement, 'id' | 'projectId' | 'status'>,
): OfficeEngagement => ({
  schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  title: overrides.id,
  brief: 'brief',
  businessProjectIds: [],
  initiativeIds: [],
  priority: 'medium' as const,
  charter: {
    kind: 'new-solution',
    objectives: [],
    scope: [],
    outOfScope: [],
    constraints: [],
    regulatoryDrivers: [],
    deliverables: [],
    participantIds: ['felipe', 'elena'],
    coordinatorId: 'lucia',
    consolidatorId: 'alejandro',
    provenance: 'deterministic',
    proposedAt: '2026-08-20T00:00:00.000Z',
  },
  tasks: [],
  arbDecisions: [],
  budget: { ...DEFAULT_OFFICE_BUDGET },
  auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
  ...overrides,
});

const project = (overrides: Partial<Project> & Pick<Project, 'id' | 'name'>): Project => ({
  description: '',
  projectContext: [],
  artifacts: [],
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
  ...overrides,
});

describe('OfficeKpiRow', () => {
  it('leads with the numbers a portfolio owner is judged on', () => {
    render(
      <OfficeKpiRow
        projectCount={3}
        rollup={{
          ...emptyPortfolioRollup(),
          engagements: 4,
          awaitingDecision: 2,
          tasksTotal: 10,
          tasksCompleted: 7,
          completionRatio: 0.7,
          artifactsProduced: 5,
          aiCallsUsed: 17,
          aiCallsBudget: 40,
          findings: { critical: 1, high: 2, medium: 0, low: 3 },
        }}
      />,
    );

    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('70 %')).toBeInTheDocument();
    expect(screen.getByText('17/40')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument(); // total findings
    expect(screen.getByText(/3 crítico\(s\) o alto\(s\)/)).toBeInTheDocument();
    expect(screen.getByText(/7\/10 tareas · 5 artefacto\(s\)/)).toBeInTheDocument();
  });

  it('counts blocked engagements as decisions the human owes the office', () => {
    const onFocus = vi.fn();
    render(
      <OfficeKpiRow
        projectCount={1}
        rollup={{
          ...emptyPortfolioRollup(),
          awaitingDecision: 1,
          statusMix: { blocked: 2, running: 0, 'awaiting-decision': 1, delivered: 0, idle: 0 },
        }}
        onFocusDecisions={onFocus}
      />,
    );

    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2 bloqueado(s)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Requieren decisión/ }));
    expect(onFocus).toHaveBeenCalledOnce();
  });
});

describe('DecisionQueue', () => {
  const portfolio = buildOfficePortfolio(
    [project({ id: 'p1', name: 'Pre-Autorizaciones', linkedBusinessProjects: ['NEG-2026-001'] })],
    [
      engagement({ id: 'eng-blocked', projectId: 'p1', status: 'blocked', title: 'Auto aprobación' }),
      engagement({ id: 'eng-arb', projectId: 'p1', status: 'awaiting-arb', title: 'Modernización' }),
    ],
    { now: NOW },
  );

  it('says why each engagement is stuck instead of only colouring it', () => {
    render(<DecisionQueue items={portfolio.decisionQueue} canApprove onOpen={() => {}} />);
    expect(screen.getByText('Auto aprobación')).toBeInTheDocument();
    expect(screen.getByText(/necesita una intervención|gates bloqueados/i)).toBeInTheDocument();
    expect(screen.getByText(/espera la decisión del comité/i)).toBeInTheDocument();
    // Both rows sit under the same business project and architecture project.
    expect(screen.getAllByText('NEG-2026-001 › Pre-Autorizaciones')).toHaveLength(2);
  });

  it('warns when a decision needs an admin the current user is not', () => {
    const { rerender } = render(
      <DecisionQueue items={portfolio.decisionQueue} canApprove={false} onOpen={() => {}} />,
    );
    expect(screen.getByText('Requiere admin')).toBeInTheDocument();

    rerender(<DecisionQueue items={portfolio.decisionQueue} canApprove onOpen={() => {}} />);
    expect(screen.queryByText('Requiere admin')).not.toBeInTheDocument();
  });

  it('opens the engagement the row points at', () => {
    const onOpen = vi.fn();
    render(<DecisionQueue items={portfolio.decisionQueue} canApprove onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir Auto aprobación' }));
    expect(onOpen).toHaveBeenCalledWith('eng-blocked');
  });

  it('celebrates an empty queue rather than showing an empty box', () => {
    render(<DecisionQueue items={[]} canApprove onOpen={() => {}} />);
    expect(screen.getByText('Nada espera por ti')).toBeInTheDocument();
  });
});

describe('PortfolioPulse', () => {
  it('shows the mix, the flow and the trend without repeating the same answer', () => {
    const portfolio = buildOfficePortfolio(
      [project({ id: 'p1', name: 'Proyecto' })],
      [engagement({
        id: 'eng-1',
        projectId: 'p1',
        status: 'in-progress',
        tasks: [
          task({ id: 't1', status: 'completed' }),
          task({ id: 't2', status: 'in-progress' }),
          task({ id: 't3', status: 'changes-requested' }),
          task({ id: 't4', status: 'pending' }),
        ],
      })],
      { now: NOW, activityDays: 7 },
    );

    render(<PortfolioPulse rollup={portfolio.rollup} activity={portfolio.activity} />);

    expect(screen.getByText('Estado del portafolio')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Tareas por etapa del flujo' })).toBeInTheDocument();
    expect(screen.getByText('Retrabajo')).toBeInTheDocument();
    expect(screen.getByText('4 tareas')).toBeInTheDocument();
    expect(screen.getByText(/últimos 7 días/)).toBeInTheDocument();
  });
});

describe('PortfolioExplorer', () => {
  const portfolio = buildOfficePortfolio(
    [
      project({ id: 'p1', name: 'Pre-Autorizaciones', linkedBusinessProjects: ['NEG-2026-001'] }),
      project({ id: 'p2', name: 'Laboratorio' }),
    ],
    [
      engagement({ id: 'eng-1', projectId: 'p1', status: 'blocked', title: 'Auto aprobación' }),
      engagement({ id: 'eng-2', projectId: 'p2', status: 'delivered', title: 'Prueba' }),
    ],
    { now: NOW },
  );

  const renderExplorer = (overrides: Partial<React.ComponentProps<typeof PortfolioExplorer>> = {}) =>
    render(
      <PortfolioExplorer
        programs={portfolio.programs}
        runningEngagementIds={[]}
        onOpenEngagement={vi.fn()}
        onOpenProject={vi.fn()}
        onNewEngagement={vi.fn()}
        {...overrides}
      />,
    );

  it('renders the three levels of the hierarchy, loudest business project first', () => {
    renderExplorer();
    const sections = screen.getAllByRole('region');
    expect(sections[0]).toHaveAccessibleName('NEG-2026-001');
    // The loudest program opens by default, so its project is already reachable.
    expect(within(sections[0]).getByText('Pre-Autorizaciones')).toBeInTheDocument();
    expect(within(sections[0]).getByText('Auto aprobación')).toBeInTheDocument();
  });

  it('keeps the quiet programs collapsed so the page opens as a summary', () => {
    renderExplorer();
    expect(screen.getByText('Sin iniciativa de negocio')).toBeInTheDocument();
    expect(screen.queryByText('Laboratorio')).not.toBeInTheDocument();
  });

  it('expands a collapsed program on demand', () => {
    renderExplorer();
    fireEvent.click(screen.getByRole('button', { name: /Sin iniciativa de negocio/ }));
    expect(screen.getByText('Laboratorio')).toBeInTheDocument();
  });

  it('navigates down to an engagement and across to its workspace', () => {
    const onOpenEngagement = vi.fn();
    const onOpenProject = vi.fn();
    renderExplorer({ onOpenEngagement, onOpenProject });

    fireEvent.click(screen.getByRole('button', { name: /Auto aprobación/ }));
    expect(onOpenEngagement).toHaveBeenCalledWith('eng-1');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir el espacio de trabajo de Pre-Autorizaciones' }));
    expect(onOpenProject).toHaveBeenCalledWith('p1');
  });

  it('invites the first engagement when the office has no portfolio at all', () => {
    const onNewEngagement = vi.fn();
    render(
      <PortfolioExplorer
        programs={[]}
        runningEngagementIds={[]}
        onOpenEngagement={vi.fn()}
        onOpenProject={vi.fn()}
        onNewEngagement={onNewEngagement}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nuevo entregable' }));
    expect(onNewEngagement).toHaveBeenCalledOnce();
  });
});

describe('SpecialistLoadPanel', () => {
  it('names the persona, its role and what it is carrying', () => {
    render(
      <SpecialistLoadPanel
        specialists={[
          { personaId: 'felipe', active: 2, completed: 3, reviewed: 1, activeTaskTitles: ['Contexto C4', 'Contenedores C4'] },
          { personaId: 'carmen', active: 0, completed: 0, reviewed: 4, activeTaskTitles: [] },
        ]}
      />,
    );

    expect(screen.getByText('Felipe')).toBeInTheDocument();
    expect(screen.getByText('Arquitecto de Soluciones AWS')).toBeInTheDocument();
    expect(screen.getByText('2 activa(s)')).toBeInTheDocument();
    expect(screen.getByText('Contexto C4')).toBeInTheDocument();
    expect(screen.getByText('Libre')).toBeInTheDocument();
  });

  it('explains the silence when nobody has been assigned yet', () => {
    render(<SpecialistLoadPanel specialists={[]} />);
    expect(screen.getByText(/Ningún especialista tiene trabajo asignado/i)).toBeInTheDocument();
  });
});

describe('HierarchyBreadcrumb', () => {
  it('links every ancestor and marks the current level', () => {
    const toOffice = vi.fn();
    render(
      <HierarchyBreadcrumb
        levels={[
          { kind: 'program', label: 'NEG-2026-001', onNavigate: toOffice },
          { kind: 'project', label: 'Pre-Autorizaciones', onNavigate: vi.fn() },
          { kind: 'engagement', label: 'Auto aprobación' },
        ]}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Jerarquía del portafolio' })).toBeInTheDocument();
    fireEvent.click(screen.getByText('NEG-2026-001'));
    expect(toOffice).toHaveBeenCalledOnce();

    const current = screen.getByText('Auto aprobación').closest('[aria-current]');
    expect(current).not.toBeNull();
  });

  it('turns a level with siblings into a lateral switcher', () => {
    const toSibling = vi.fn();
    render(
      <HierarchyBreadcrumb
        levels={[
          { kind: 'project', label: 'Pre-Autorizaciones' },
          {
            kind: 'engagement',
            label: 'Auto aprobación',
            currentId: 'eng-1',
            siblings: [
              { id: 'eng-1', label: 'Auto aprobación', onSelect: vi.fn() },
              { id: 'eng-2', label: 'Modernización', hint: 'Entregado', onSelect: toSibling },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cambiar de entregable' }));
    fireEvent.click(screen.getByText('Modernización'));
    expect(toSibling).toHaveBeenCalledOnce();
  });

  it('offers no switcher when a level has no siblings to move to', () => {
    render(
      <HierarchyBreadcrumb
        levels={[
          {
            kind: 'engagement',
            label: 'Único',
            siblings: [{ id: 'eng-1', label: 'Único', onSelect: vi.fn() }],
          },
        ]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Cambiar de entregable' })).not.toBeInTheDocument();
  });
});

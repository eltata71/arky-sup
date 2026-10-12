/**
 * 13.4 — the five main screens, each in its three states.
 *
 * Loading shows the screen's shape, never a spinner and never the empty state.
 * A failed read says so and offers «Reintentar» and «Ver diagnóstico»; it is
 * never shown as «todavía no hay…», which over a read that did not arrive tells
 * someone their work is gone. Empty says the next step of the hierarchy.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translate, INITIAL_TRANSLATIONS } from '../../lib/i18n';

const state = vi.hoisted(() => ({
  projectsLoading: false,
  projectsError: null as string | null,
  initiativesLoading: false,
  initiativesError: null as string | null,
  officeError: null as string | null,
  reload: vi.fn(),
  reloadInitiatives: vi.fn(async () => undefined),
  retryLoad: vi.fn(),
}));

const t = (key: string, replacements?: Record<string, string>) => translate(INITIAL_TRANSLATIONS, 'es', key, replacements);

vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({
    projects: [],
    settings: { aiConfig: {}, language: 'es' },
    isLoading: state.projectsLoading,
    loadError: state.projectsError,
    reload: state.reload,
    t,
    deleteProject: vi.fn(),
    runProjectCommand: vi.fn(),
    deleteArtifact: vi.fn(),
    findLatestArtifactByName: vi.fn(),
    removeCorruptArtifacts: vi.fn(),
    updateProjectContext: vi.fn(),
  }),
  useOptionalAppContext: () => undefined,
}));
vi.mock('../../context/InitiativeContext', () => ({
  useInitiatives: () => ({
    initiatives: [],
    isLoading: state.initiativesLoading,
    loadError: state.initiativesError,
    reload: state.reloadInitiatives,
    usedCodes: [],
    createInitiative: vi.fn(),
    runInitiativeCommand: vi.fn(),
    deleteInitiative: vi.fn(),
    getInitiative: vi.fn(),
  }),
}));
vi.mock('../../context/OfficeContext', () => ({
  useOffice: () => ({
    engagements: [],
    runningEngagementIds: [],
    isLoading: false,
    isResolving: false,
    loadError: state.officeError,
    retryLoad: state.retryLoad,
    canApprove: false,
    loadEngagements: vi.fn(),
    createEngagement: vi.fn(),
    approveCharter: vi.fn(),
    requestCharterChanges: vi.fn(),
    runEngagementNow: vi.fn(),
    listEngagementsForProject: () => [],
  }),
}));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../../context/CommandPaletteContext', () => ({ useRegisterCommands: vi.fn() }));
vi.mock('../../hooks/useProjectArtifacts', () => ({ useProjectArtifacts: vi.fn() }));
vi.mock('../../hooks/artifacts/useGenerationQueue', () => ({ useGenerationQueue: () => ({ enqueue: vi.fn() }) }));

import DashboardPage from '../../pages/DashboardPage';
import InitiativesPage from '../../pages/InitiativesPage';
import ProjectsPage from '../../pages/ProjectsPage';
import OfficePage from '../../pages/OfficePage';
import Workspace from '../../pages/Workspace';

const renderAt = (path: string, pattern: string, element: React.ReactElement) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path={pattern} element={element} />
    </Routes>
  </MemoryRouter>,
);

const SCREENS = [
  { name: 'Dashboard', render: () => renderAt('/', '/', <DashboardPage />), subject: 'los datos del portafolio' },
  { name: 'Iniciativas', render: () => renderAt('/initiatives', '/initiatives', <InitiativesPage />), subject: 'las iniciativas' },
  { name: 'Proyectos', render: () => renderAt('/projects', '/projects', <ProjectsPage navigateToWorkspace={vi.fn()} />), subject: 'los proyectos' },
  { name: 'Entregables', render: () => renderAt('/office', '/office', <OfficePage />), subject: 'los entregables' },
  { name: 'Workspace', render: () => renderAt('/workspace/p-1', '/workspace/:projectId', <Workspace projectId="p-1" />), subject: 'el proyecto' },
] as const;

beforeEach(() => {
  state.projectsLoading = false;
  state.projectsError = null;
  state.initiativesLoading = false;
  state.initiativesError = null;
  state.officeError = null;
  state.reload.mockClear();
  state.reloadInitiatives.mockClear();
  state.retryLoad.mockClear();
});

const failRead = (screenName: string) => {
  if (screenName === 'Iniciativas') state.initiativesError = 'network down';
  else if (screenName === 'Entregables') state.officeError = 'network down';
  else state.projectsError = 'network down';
};

describe.each(SCREENS)('$name', ({ name, render: renderScreen, subject }) => {
  it('loading: shows its shape as a status, not the empty state', () => {
    state.projectsLoading = true;
    state.initiativesLoading = true;
    renderScreen();
    const status = screen.getAllByRole('status').find((node) => node.getAttribute('aria-busy') === 'true');
    expect(status).toBeDefined();
    expect(document.querySelector('.animate-spin')).toBeNull();
    expect(screen.queryByText(/todavía no hay|todavía está vacío|no encontrado/i)).toBeNull();
  });

  it('error: says what failed and offers to retry, never the empty state', () => {
    failRead(name);
    renderScreen();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(`No se pudieron cargar ${subject}`);
    expect(alert).toHaveTextContent('network down');
    expect(screen.queryByText(/todavía no hay|todavía está vacío|no encontrado/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(state.reload.mock.calls.length + state.reloadInitiatives.mock.calls.length + state.retryLoad.mock.calls.length).toBe(1);
  });

  it('empty: offers the next step of the hierarchy', () => {
    renderScreen();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('button').some((button) => /iniciativa|proyecto|entregable|Proyectos|Dashboard/i.test(button.textContent ?? ''))).toBe(true);
  });
});

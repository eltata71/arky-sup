/**
 * «Todavía no lo sé» no es «no existe» (F6-04).
 *
 * La sala de un entregable decía «El entregable que buscas no existe o todavía
 * no se ha cargado» mientras cargaba: dos respuestas en una frase. Un recorrido
 * E2E la leyó como «ya firmado» y saltó la firma. Ahora, mientras la Oficina
 * resuelve, la sala muestra la carga; «no encontrado» sólo cuando ha terminado.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ isResolving: true, projectsLoading: false }));

vi.mock('../../context/AppContext', () => ({
  useAppContext: () => ({ projects: [], settings: { aiConfig: {} }, isLoading: state.projectsLoading }),
}));
vi.mock('../../context/OfficeContext', () => ({
  useOffice: () => ({
    engagements: [],
    isResolving: state.isResolving,
    runningEngagementIds: [],
    arbEligibility: () => ({ eligible: false }),
    loadEngagements: vi.fn(),
    approveCharter: vi.fn(),
    runEngagementNow: vi.fn(),
    cancelRun: vi.fn(),
    evaluateGates: vi.fn(),
    decideEngagement: vi.fn(),
  }),
}));
vi.mock('../../context/InitiativeContext', () => ({ useInitiatives: () => ({ initiatives: [] }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('../../hooks/useAriaAnnouncer', () => ({ useAriaAnnouncer: () => ({ announce: vi.fn() }) }));

import EngagementRoom from '../../pages/EngagementRoom';

const renderRoom = () => render(
  <MemoryRouter initialEntries={['/office/eng-1']}>
    <Routes>
      <Route path="/office/:engagementId" element={<EngagementRoom />} />
    </Routes>
  </MemoryRouter>,
);

describe('EngagementRoom — cargando no es «no encontrado»', () => {
  it('mientras la Oficina resuelve muestra la carga, no la ausencia', () => {
    state.isResolving = true;
    renderRoom();
    expect(screen.getByRole('status', { name: 'Cargando el entregable' })).toBeInTheDocument();
    expect(screen.queryByText('Entregable no encontrado')).toBeNull();
  });

  it('mientras cargan los proyectos, también', () => {
    state.isResolving = false;
    state.projectsLoading = true;
    renderRoom();
    expect(screen.queryByText('Entregable no encontrado')).toBeNull();
  });

  it('resuelto y sin el encargo, dice que no existe — y sólo eso', () => {
    state.isResolving = false;
    state.projectsLoading = false;
    renderRoom();
    expect(screen.getByText('Entregable no encontrado')).toBeInTheDocument();
    expect(screen.queryByText(/todavía no se ha cargado/)).toBeNull();
  });
});

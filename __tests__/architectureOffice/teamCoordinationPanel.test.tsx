import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TeamCoordinationPanel } from '../../components/architectureOffice/TeamCoordinationPanel';
import {
  teamFromPlan,
  type CoordinationEvent,
} from '../../services/architectureOffice/officeCoordination';
import { planOfficeWorkstreams } from '../../services/architectureOffice/officeOrchestration';

const team = teamFromPlan(planOfficeWorkstreams('modernizar el AS/400 con MuleSoft en AWS'));

const event = (over: Partial<CoordinationEvent>): CoordinationEvent => ({
  id: `e-${Math.random()}`,
  kind: 'agent-reported',
  phase: 'reporting',
  from: 'felipe',
  to: 'alejandro',
  summary: 'Felipe entrega su análisis.',
  elapsedMs: 1200,
  ...over,
});

describe('TeamCoordinationPanel', () => {
  it('invites a first request instead of drawing an empty diagram', () => {
    render(<TeamCoordinationPanel team={[]} events={[]} />);
    expect(screen.getByText(/El equipo aparece aquí/i)).toBeInTheDocument();
  });

  it('names the coordinator and the consolidator by their standing role', () => {
    render(<TeamCoordinationPanel team={team} events={[]} />);
    expect(screen.getByText('Coordina')).toBeInTheDocument();
    expect(screen.getByText('Consolida')).toBeInTheDocument();
  });

  it('carries a failure through to the agent, not just to the log', () => {
    render(
      <TeamCoordinationPanel
        team={team}
        events={[event({ kind: 'agent-failed', from: 'felipe', to: null, summary: 'Felipe no pudo completar su parte.' })]}
      />,
    );
    // The state must be legible on the node itself: a reader scanning the
    // diagram should not have to read the log to find what broke.
    expect(screen.getByText('Falló')).toBeInTheDocument();
  });

  it('does not let a later event overwrite a failure', () => {
    render(
      <TeamCoordinationPanel
        team={team}
        events={[
          event({ kind: 'agent-failed', from: 'felipe', to: null, summary: 'Felipe no pudo completar su parte.' }),
          event({ kind: 'handoff', from: 'felipe', to: 'alejandro', summary: 'El flujo continúa sin ese análisis.' }),
        ]}
      />,
    );
    expect(screen.getByText('Falló')).toBeInTheDocument();
  });

  it('attributes a user-authored event to the user, not to an agent', () => {
    render(
      <TeamCoordinationPanel
        team={team}
        events={[event({ kind: 'request-received', from: null, to: 'lucia', summary: 'Lucía recibe la solicitud.' })]}
      />,
    );
    const log = screen.getByLabelText('Bitácora de coordinación');
    expect(within(log).getByText('Tú')).toBeInTheDocument();
  });

  it('describes the topology for a reader who cannot see the diagram', () => {
    render(<TeamCoordinationPanel team={team} events={[]} />);
    const figure = screen.getByRole('img');
    expect(figure.getAttribute('aria-label')).toMatch(/reparte a \d+ especialista/i);
  });
});

describe('TeamCoordinationPanel — inspection controls', () => {
  const events = [
    event({ kind: 'request-received', from: null, to: 'lucia', summary: 'Lucía recibe la solicitud.' }),
    event({ kind: 'agent-reported', from: 'felipe', to: 'alejandro', summary: 'Felipe entrega su análisis.' }),
    event({ kind: 'agent-reported', from: 'mauricio', to: 'alejandro', summary: 'Mauricio entrega su análisis.' }),
  ];

  it('narrows the log to one agent, because parallel threads interleave', () => {
    render(<TeamCoordinationPanel team={team} events={events} />);
    const log = () => screen.getByLabelText(/Bitácora de coordinación/);

    expect(within(log()).getByText(/Felipe entrega/)).toBeInTheDocument();
    expect(within(log()).getByText(/Mauricio entrega/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Felipe/ }));
    expect(within(log()).getByText(/Felipe entrega/)).toBeInTheDocument();
    expect(within(log()).queryByText(/Mauricio entrega/)).not.toBeInTheDocument();
  });

  it("says in the log's own name that it is filtered", () => {
    render(<TeamCoordinationPanel team={team} events={events} />);
    fireEvent.click(screen.getByRole('button', { name: /^Felipe/ }));
    expect(screen.getByLabelText('Bitácora de coordinación, filtrada por Felipe')).toBeInTheDocument();
  });

  it('explains an empty filter instead of showing a blank list', () => {
    render(<TeamCoordinationPanel team={team} events={[events[1]]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Mauricio/ }));
    expect(screen.getByText(/Mauricio todavía no ha intervenido/)).toBeInTheDocument();
  });

  it('does not crash when the log is empty and nothing is filtered', () => {
    // The empty-state copy names the focused agent; with no filter there is
    // none, and dereferencing it crashed the panel.
    expect(() => render(<TeamCoordinationPanel team={team} events={[]} />)).not.toThrow();
  });

  it('lets the reader put the diagram away and get it back', () => {
    render(<TeamCoordinationPanel team={team} events={events} />);
    const toggle = screen.getByRole('button', { name: /Coordinación del equipo/ });
    expect(screen.getByRole('img')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByRole('img')).toBeInTheDocument();
  });

  it('offers expansion only when the host can honour it', () => {
    const { rerender } = render(<TeamCoordinationPanel team={team} events={events} />);
    expect(screen.queryByRole('button', { name: /Expandir el panel/ })).not.toBeInTheDocument();

    const onToggleExpand = vi.fn();
    rerender(<TeamCoordinationPanel team={team} events={events} onToggleExpand={onToggleExpand} />);
    fireEvent.click(screen.getByRole('button', { name: /Expandir el panel/ }));
    expect(onToggleExpand).toHaveBeenCalledOnce();
  });

  it('carries agent state as words too, since a dot is invisible to a reader', () => {
    render(
      <TeamCoordinationPanel
        team={team}
        events={[event({ kind: 'agent-failed', from: 'felipe', to: null, summary: 'Felipe falló.' })]}
      />,
    );
    expect(screen.getByRole('button', { name: /Felipe, Falló/ })).toBeInTheDocument();
  });
});

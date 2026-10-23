/**
 * El panel de calidad de agentes (20.1): ventana, "sin medir" y accesibilidad.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

const engagements: unknown[] = [];
vi.mock('../../context/OfficeContext', () => ({ useOffice: () => ({ engagements }) }));
vi.mock('../../hooks/useAgentDisplayName', () => ({ useAgentDisplayName: () => (id: string) => id }));

import { AgentQualityPanel } from '../../components/architectureOffice/agentProfile/AgentQualityPanel';

const recent = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString();

const withTasks = () => {
  engagements.length = 0;
  engagements.push({
    id: 'e1',
    tasks: [
      { id: 't1', kind: 'produce-artifact', assigneeId: 'elena', status: 'completed', attempts: 1, completedAt: recent(1), measurements: [{ model: null, usage: null, latencyMs: 0, traceId: null, estimatedCostUsd: null }] },
      { id: 't2', kind: 'produce-artifact', assigneeId: 'elena', status: 'completed', attempts: 2, completedAt: recent(20) },
    ],
  });
};

describe('AgentQualityPanel', () => {
  it('sin tareas dice «sin medir» y no dibuja ceros', () => {
    engagements.length = 0;
    render(<AgentQualityPanel />);
    expect(screen.getByRole('status')).toHaveTextContent(/Sin medir: no hay tareas de agentes en los últimos 30 días/);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('la ventana de 7 días deja fuera lo anterior', () => {
    withTasks();
    render(<AgentQualityPanel />);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /elena 2/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '7 días' }));
    expect(screen.getByRole('row', { name: /elena 1/ })).toBeInTheDocument();
  });

  it('lo no medido se lee «sin medir», no 0', () => {
    withTasks();
    render(<AgentQualityPanel />);
    fireEvent.click(screen.getByRole('button', { name: '7 días' }));
    const row = screen.getByRole('row', { name: /elena/ });
    expect(row).toHaveTextContent('sin medir');
    expect(row).not.toHaveTextContent('$0');
    expect(row).toHaveTextContent('aún no se registra');
  });

  it('no tiene hallazgos de accesibilidad (axe)', async () => {
    withTasks();
    const { container } = render(<main><AgentQualityPanel /></main>);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});

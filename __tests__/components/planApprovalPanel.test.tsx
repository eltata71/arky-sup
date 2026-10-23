/**
 * El panel de aprobación del plan (20.2): decide la persona, y sin hallazgos de axe.
 */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import axe from 'axe-core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useAgentDisplayName', () => ({ useAgentDisplayName: () => (id: string) => id }));

import { PlanApprovalPanel } from '../../components/architectureOffice/PlanApprovalPanel';
import { usePlanApprovalGate } from '../../hooks/usePlanApprovalGate';
import type { PlanApprovalProposal } from '../../services/architectureOffice/application/planApproval';

const proposal: PlanApprovalProposal = {
  operationId: 'op1',
  request: 'x',
  coordinatorId: 'lucia',
  consolidatorId: 'alejandro',
  specialists: [
    { personaId: 'elena', objective: 'Seguridad', acceptanceCriteria: [] },
    { personaId: 'felipe', objective: 'Nube', acceptanceCriteria: [] },
    { personaId: 'sofia', objective: 'Datos', acceptanceCriteria: [] },
  ],
  maxModelCalls: 6,
};

describe('PlanApprovalPanel', () => {
  it('no pinta nada sin propuesta', () => {
    const { result } = renderHook(() => usePlanApprovalGate());
    const { container } = render(<PlanApprovalPanel gate={result.current} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('nombra al equipo, acota las llamadas y entrega la decisión de la persona', async () => {
    const { result } = renderHook(() => usePlanApprovalGate());
    let decision: Promise<unknown> = Promise.resolve();
    act(() => { decision = result.current.request(proposal); });
    const { rerender } = render(<PlanApprovalPanel gate={result.current} />);
    expect(screen.getByText(/hasta 6 llamadas al modelo/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/felipe/));
    rerender(<PlanApprovalPanel gate={result.current} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar y empezar' }));
    await expect(decision).resolves.toEqual({ decision: 'approve', removeSpecialists: ['felipe'] });
    expect(result.current.pending).toBeNull();
  });

  it('cancelar entrega «cancel»', async () => {
    const { result } = renderHook(() => usePlanApprovalGate());
    let decision: Promise<unknown> = Promise.resolve();
    act(() => { decision = result.current.request(proposal); });
    render(<PlanApprovalPanel gate={result.current} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await expect(decision).resolves.toEqual({ decision: 'cancel' });
  });

  it('no deja quitar al último especialista', () => {
    const { result } = renderHook(() => usePlanApprovalGate());
    act(() => { void result.current.request({ ...proposal, specialists: proposal.specialists.slice(0, 1) }); });
    render(<PlanApprovalPanel gate={result.current} />);
    expect(screen.getByLabelText(/elena/)).toBeDisabled();
  });

  it('cerrar el dock con una propuesta abierta la cancela', async () => {
    const { result, unmount } = renderHook(() => usePlanApprovalGate());
    let decision: Promise<unknown> = Promise.resolve();
    act(() => { decision = result.current.request(proposal); });
    unmount();
    await expect(decision).resolves.toEqual({ decision: 'cancel' });
  });

  it('no tiene hallazgos de accesibilidad (axe)', async () => {
    const { result } = renderHook(() => usePlanApprovalGate());
    act(() => { void result.current.request(proposal); });
    const { container } = render(<main><PlanApprovalPanel gate={result.current} /></main>);
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});

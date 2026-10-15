import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OperationTracePanel } from '../../components/architectureOffice/OperationTracePanel';
import type { CoordinationOutcome } from '../../services/architectureOffice/application/officeCoordination';

const outcome = {
  status: 'completed',
  team: [{ personaId: 'elena', role: 'specialist', rationale: 'dominio' }],
  events: [],
  contributions: [{ personaId: 'elena', status: 'completed' }],
  rejectedHandoffs: [],
  promptStamps: ['office.review@v1#3f2a9c1e'],
} as unknown as CoordinationOutcome;

describe('OperationTracePanel', () => {
  it('abre con el teclado/botón, muestra el árbol y los sellos, y exporta', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<OperationTracePanel outcome={outcome} />);
    const toggle = screen.getAllByRole('button')[0];
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('tree')).toBeInTheDocument();
    expect(screen.getByText(/office\.review@v1#3f2a9c1e/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button')[1]);
    await screen.findByRole('status');
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).not.toContain('AIza');
  });
});

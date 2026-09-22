import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { Artifact } from '../../../../lib/artifacts';
import { SourceSelectionCard } from '../../../../components/artifacts/wizard/SourceSelectionCard';

const artifact: Artifact = {
  id: 'a-123',
  versionGroupId: 'a-123',
  version: 2,
  createdAt: '2026-04-15T00:00:00.000Z',
  name: 'Inventario de APIs',
  type: 'markdown',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '...',
  objective: 'Listar los endpoints REST y eventos de dominio del core.',
  keyConcepts: [],
  representation: 'document',
};

describe('SourceSelectionCard', () => {
  it('shows name, type chip and objective by default; hides technical detail until expanded', () => {
    render(<SourceSelectionCard artifact={artifact} use="none" onChange={vi.fn()} />);
    expect(screen.getByText(/Inventario de APIs/i)).toBeInTheDocument();
    expect(screen.getByText(/Vista Lógica y de Diseño/i)).toBeInTheDocument();
    // Technical detail is hidden by default
    expect(screen.queryByText(/v2/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ver detalle técnico/i }));
    expect(screen.getByText(/v2/i)).toBeInTheDocument();
    expect(screen.getByText(artifact.id)).toBeInTheDocument();
  });

  it('emits the new use when the dropdown changes', () => {
    const onChange = vi.fn();
    render(<SourceSelectionCard artifact={artifact} use="none" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/Uso de fuente Inventario de APIs/i), { target: { value: 'required' } });
    expect(onChange).toHaveBeenCalledWith('required');
  });
});

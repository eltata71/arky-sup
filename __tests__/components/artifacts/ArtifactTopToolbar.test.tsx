import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { ArtifactTopToolbar } from '../../../components/artifacts/toolbar/ArtifactTopToolbar';
import type { Artifact } from '../../../lib/artifacts';

const artifact: Artifact = {
  id: 'a1',
  versionGroupId: 'a1',
  version: 3,
  createdAt: '2026-05-15T00:00:00.000Z',
  name: 'Diagrama de contexto',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'flowchart LR\n  A --> B',
  objective: 'Modelar el contexto',
  keyConcepts: [],
  representation: 'diagram',
};

const noop = () => {};

const baseProps = {
  projectName: 'Core bancario',
  artifact,
  viewMode: 'diagram' as const,
  availableViews: ['diagram', 'document', 'split'] as const,
  onBack: noop,
  onSelectView: noop,
  onOpenSuggestions: noop,
  onOpenInspector: noop,
  onOpenExport: noop,
};

describe('ArtifactTopToolbar', () => {
  it('renders the primary view switcher (Diagrama / Documento / Híbrido)', () => {
    render(<ArtifactTopToolbar {...baseProps} availableViews={[...baseProps.availableViews]} />);
    expect(screen.getByRole('tab', { name: 'Diagrama' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Documento' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Híbrido' })).toBeInTheDocument();
  });

  it('exposes only the four primary actions (views + Sugerencias + Inspeccionar + Exportar)', () => {
    render(<ArtifactTopToolbar {...baseProps} availableViews={[...baseProps.availableViews]} />);
    expect(screen.getByRole('button', { name: 'Sugerencias' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspeccionar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeInTheDocument();
    // No secondary/technical control leaks into the top toolbar.
    expect(screen.queryByText(/Observabilidad/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mini mapa/i)).not.toBeInTheDocument();
  });

  it('fires the primary action callbacks', () => {
    const onOpenSuggestions = vi.fn();
    const onOpenInspector = vi.fn();
    const onOpenExport = vi.fn();
    const onSelectView = vi.fn();
    render(
      <ArtifactTopToolbar
        {...baseProps}
        availableViews={[...baseProps.availableViews]}
        onOpenSuggestions={onOpenSuggestions}
        onOpenInspector={onOpenInspector}
        onOpenExport={onOpenExport}
        onSelectView={onSelectView}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sugerencias' }));
    fireEvent.click(screen.getByRole('button', { name: 'Inspeccionar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exportar' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Documento' }));
    expect(onOpenSuggestions).toHaveBeenCalledTimes(1);
    expect(onOpenInspector).toHaveBeenCalledTimes(1);
    expect(onOpenExport).toHaveBeenCalledTimes(1);
    expect(onSelectView).toHaveBeenCalledWith('document');
  });

  it('only renders view tabs the artifact can actually display', () => {
    render(<ArtifactTopToolbar {...baseProps} availableViews={['document']} />);
    expect(screen.getByRole('tab', { name: 'Documento' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Diagrama' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Híbrido' })).not.toBeInTheDocument();
  });
});

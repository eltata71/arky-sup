import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { ArtifactBottomToolbar } from '../../../components/artifacts/toolbar/ArtifactBottomToolbar';
import type { ArtifactBottomToolbarProps } from '../../../components/artifacts/toolbar/ArtifactBottomToolbar';

const noop = () => {};

const baseProps: ArtifactBottomToolbarProps = {
  representation: 'diagram',
  viewMode: 'diagram',
  availableViews: ['diagram', 'document', 'split', 'markdown'],
  isDiagramSurface: true,
  hasIR: true,
  onZoomIn: noop,
  onZoomOut: noop,
  onFitView: noop,
  onCenter: noop,
  isFullscreen: false,
  onToggleFullscreen: noop,
  showMiniMap: false,
  onToggleMiniMap: noop,
  onStartPresentation: noop,
  onOpenOnePager: noop,
  audience: 'technical',
  onChangeAudience: noop,
  isEditMode: false,
  onToggleEdit: noop,
  onSaveDiagram: noop,
  onConvertToDoc: noop,
  onGenerateTests: noop,
  isSpeaking: false,
  onToggleSpeech: noop,
  showQualityPanel: false,
  onToggleQualityPanel: noop,
  qualityScore: 80,
  hasQualityReport: true,
  onAutoImprove: noop,
  isAutoImproving: false,
  onGenerateWorldClass: noop,
  onOpenSuggestions: noop,
  showTracePanel: false,
  onToggleTracePanel: noop,
  traceErrors: 0,
  hasObservabilityAlert: false,
  diagnosticCopied: false,
  hasDiagnosticReport: true,
  onCopyDiagnosticReport: noop,
  onSelectView: noop,
};

describe('ArtifactBottomToolbar', () => {
  it('renders the six grouped action menus', () => {
    render(<ArtifactBottomToolbar {...baseProps} />);
    for (const group of ['Navegación', 'Presentación', 'Edición', 'Calidad e IA', 'Observabilidad', 'Configuración']) {
      expect(screen.getByRole('button', { name: group })).toBeInTheDocument();
    }
  });

  it('keeps every group menu collapsed until opened (popover behaviour)', () => {
    render(<ArtifactBottomToolbar {...baseProps} />);
    expect(screen.queryByText('Mostrar mini mapa')).not.toBeInTheDocument();
    expect(screen.queryByText('Traza de generación')).not.toBeInTheDocument();
  });

  it('exposes the minimap toggle (hidden by default) inside Navegación', () => {
    const onToggleMiniMap = vi.fn();
    render(<ArtifactBottomToolbar {...baseProps} onToggleMiniMap={onToggleMiniMap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Navegación' }));
    const minimap = screen.getByText('Mostrar mini mapa');
    expect(minimap).toBeInTheDocument();
    fireEvent.click(minimap);
    expect(onToggleMiniMap).toHaveBeenCalledTimes(1);
  });

  it('opens the generation trace on demand from the Observabilidad menu', () => {
    const onToggleTracePanel = vi.fn();
    render(<ArtifactBottomToolbar {...baseProps} onToggleTracePanel={onToggleTracePanel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Observabilidad' }));
    fireEvent.click(screen.getByText('Traza de generación'));
    expect(onToggleTracePanel).toHaveBeenCalledTimes(1);
  });

  it('groups the AI improvement actions inside Calidad e IA', () => {
    const onGenerateWorldClass = vi.fn();
    const onOpenSuggestions = vi.fn();
    render(
      <ArtifactBottomToolbar
        {...baseProps}
        onGenerateWorldClass={onGenerateWorldClass}
        onOpenSuggestions={onOpenSuggestions}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Calidad e IA' }));
    fireEvent.click(screen.getByText('Generar versión de clase mundial'));
    expect(onGenerateWorldClass).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Calidad e IA' }));
    fireEvent.click(screen.getByText('Mejorar con IA (Sugerencias)'));
    expect(onOpenSuggestions).toHaveBeenCalledTimes(1);
  });

  it('closes an open menu when Escape is pressed', () => {
    render(<ArtifactBottomToolbar {...baseProps} />);
    const trigger = screen.getByRole('button', { name: 'Edición' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  // Recomendación 6: visual quality gate tone on the presentation entry.
  describe('presentationGateTone — Visual Quality Gate hint', () => {
    it('uses the neutral description when the gate is ready or undefined', () => {
      render(<ArtifactBottomToolbar {...baseProps} />);
      fireEvent.click(screen.getByRole('button', { name: 'Presentación' }));
      expect(screen.getByText('Recorrido escena por escena')).toBeInTheDocument();
      expect(screen.queryByText(/Gate bloqueado/i)).not.toBeInTheDocument();
    });

    it('surfaces a warning hint when the gate has advertencias', () => {
      render(<ArtifactBottomToolbar {...baseProps} presentationGateTone="warn" />);
      fireEvent.click(screen.getByRole('button', { name: 'Presentación' }));
      expect(screen.getByText(/Gate con advertencias/i)).toBeInTheDocument();
    });

    it('surfaces a block hint when the gate is bloqueado', () => {
      render(<ArtifactBottomToolbar {...baseProps} presentationGateTone="block" />);
      fireEvent.click(screen.getByRole('button', { name: 'Presentación' }));
      expect(screen.getByText(/Gate bloqueado/i)).toBeInTheDocument();
    });
  });
});

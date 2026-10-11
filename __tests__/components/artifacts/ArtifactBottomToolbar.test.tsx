import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ArtifactBottomToolbar } from '../../../components/artifacts/toolbar/ArtifactBottomToolbar';
import type { ArtifactBottomToolbarProps } from '../../../components/artifacts/toolbar/ArtifactBottomToolbar';
import { CommandPaletteProvider, useCommandPalette } from '../../../context/CommandPaletteContext';
import { buildCanvasActions } from '../../../components/artifacts/toolbar/canvasActions';
import { CANVAS_ACTION_PLACEMENT, CANVAS_INTENTS, CANVAS_SHORTCUTS } from '../../../components/artifacts/toolbar/canvasIntents';

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

/**
 * 12.5 — the inventory before the reorganisation. Every one of these must
 * still be reachable afterwards; a test fails if one is dropped.
 */
const BEFORE_12_5 = {
  'Navegación': ['zoom-in', 'zoom-out', 'fit', 'center', 'fullscreen', 'minimap'],
  'Presentación': ['present', 'edit-story', 'brief', 'publication', 'aud-exec', 'aud-tech', 'aud-ops'],
  'Edición': ['edit', 'save-diagram', 'convert', 'tests', 'speech'],
  'Calidad e IA': ['suggestions', 'quality-panel', 'auto-improve', 'world-class'],
  'Observabilidad': ['trace', 'copy-report'],
  'Configuración': ['view-markdown', 'view-fable', 'view-excalidraw', 'view-lucidchart'],
} as const;

const openMenu = (intent: string) => fireEvent.click(screen.getByRole('button', { name: `Más acciones para ${intent}` }));
const shortcut = (code: string) => fireEvent.keyDown(window, { code, key: code.replace('Key', ''), altKey: true, shiftKey: true });

describe('ArtifactBottomToolbar — Revisar · Mejorar · Compartir (12.5)', () => {
  it('shows three intents and a technical detail, instead of six groups', () => {
    render(<ArtifactBottomToolbar {...baseProps} onEditStory={noop} />);
    const bar = screen.getByRole('toolbar', { name: 'Acciones del artefacto' });
    expect(within(bar).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Revisar', 'Mejorar', 'Compartir']);
    expect(screen.getByRole('button', { name: 'Detalle técnico' })).toBeInTheDocument();
    for (const old of ['Navegación', 'Presentación', 'Edición', 'Calidad e IA', 'Observabilidad', 'Configuración']) {
      expect(screen.queryByRole('button', { name: old })).not.toBeInTheDocument();
    }
  });

  it('runs each primary action in one click', () => {
    const onToggleQualityPanel = vi.fn();
    const onOpenSuggestions = vi.fn();
    const onStartPresentation = vi.fn();
    render(<ArtifactBottomToolbar {...baseProps} onToggleQualityPanel={onToggleQualityPanel} onOpenSuggestions={onOpenSuggestions} onStartPresentation={onStartPresentation} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revisar: Revalidar calidad · 80/100' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mejorar: Mejorar con IA (Sugerencias)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Compartir: Modo presentación' }));
    expect(onToggleQualityPanel).toHaveBeenCalledTimes(1);
    expect(onOpenSuggestions).toHaveBeenCalledTimes(1);
    expect(onStartPresentation).toHaveBeenCalledTimes(1);
  });

  it('gives every primary action a shortcut, announced and working', () => {
    const onToggleQualityPanel = vi.fn();
    const onOpenSuggestions = vi.fn();
    const onStartPresentation = vi.fn();
    const onToggleEdit = vi.fn();
    const onToggleTracePanel = vi.fn();
    render(<ArtifactBottomToolbar {...baseProps} {...{ onToggleQualityPanel, onOpenSuggestions, onStartPresentation, onToggleEdit, onToggleTracePanel }} />);
    for (const { primary } of CANVAS_INTENTS) expect(CANVAS_SHORTCUTS[primary]).toBeDefined();
    expect(screen.getByRole('button', { name: 'Compartir: Modo presentación' })).toHaveAttribute('aria-keyshortcuts', 'Alt+Shift+P');
    shortcut('KeyR'); shortcut('KeyM'); shortcut('KeyP'); shortcut('KeyE'); shortcut('KeyD');
    for (const handler of [onToggleQualityPanel, onOpenSuggestions, onStartPresentation, onToggleEdit, onToggleTracePanel]) {
      expect(handler).toHaveBeenCalledTimes(1);
    }
  });

  it('does not fire a disabled action from its shortcut, nor without both modifiers', () => {
    const onStartPresentation = vi.fn();
    render(<ArtifactBottomToolbar {...baseProps} hasIR={false} onStartPresentation={onStartPresentation} />);
    shortcut('KeyP');
    fireEvent.keyDown(window, { code: 'KeyP', key: 'P', shiftKey: true });
    expect(onStartPresentation).not.toHaveBeenCalled();
  });

  it('Revisar holds quality, viewing, audience and the other views', () => {
    const onToggleMiniMap = vi.fn();
    const onSelectView = vi.fn();
    render(<ArtifactBottomToolbar {...baseProps} onToggleMiniMap={onToggleMiniMap} onSelectView={onSelectView} />);
    openMenu('Revisar');
    for (const label of ['Ver', 'Audiencia (ajustes visuales)', 'Abrir en otra vista']) expect(screen.getByText(label)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Mostrar mini mapa'));
    expect(onToggleMiniMap).toHaveBeenCalledTimes(1);
    openMenu('Revisar');
    fireEvent.click(screen.getByText('Vista Markdown'));
    expect(onSelectView).toHaveBeenCalledWith('markdown');
  });

  it('Mejorar holds the AI improvements, editing and derived artifacts', () => {
    const onGenerateWorldClass = vi.fn();
    const onGenerateTests = vi.fn();
    render(<ArtifactBottomToolbar {...baseProps} onGenerateWorldClass={onGenerateWorldClass} onGenerateTests={onGenerateTests} />);
    openMenu('Mejorar');
    for (const label of ['Con IA', 'Derivar', 'Editar contenido', 'Guardar diagrama']) expect(screen.getByText(label)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Generar versión de clase mundial'));
    openMenu('Mejorar');
    fireEvent.click(screen.getByText('Generar casos de prueba'));
    expect(onGenerateWorldClass).toHaveBeenCalledTimes(1);
    expect(onGenerateTests).toHaveBeenCalledTimes(1);
  });

  it('Compartir holds presenting, the brief and the publication view', () => {
    const onOpenOnePager = vi.fn();
    render(<ArtifactBottomToolbar {...baseProps} onOpenOnePager={onOpenOnePager} />);
    openMenu('Compartir');
    expect(screen.getByText('Vista publicación')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Brief ejecutivo'));
    expect(onOpenOnePager).toHaveBeenCalledTimes(1);
  });

  it('keeps the trace behind «Detalle técnico», marking it when the trace has errors', () => {
    const onToggleTracePanel = vi.fn();
    render(<ArtifactBottomToolbar {...baseProps} traceErrors={2} onToggleTracePanel={onToggleTracePanel} />);
    expect(screen.queryByText('Traza de generación')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Detalle técnico: 2 errores en la traza' }));
    fireEvent.click(screen.getByText('Traza de generación'));
    expect(onToggleTracePanel).toHaveBeenCalledTimes(1);
  });

  it('closes an open menu when Escape is pressed', () => {
    render(<ArtifactBottomToolbar {...baseProps} />);
    const trigger = screen.getByRole('button', { name: 'Más acciones para Mejorar' });
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('loses no action: the inventory before 12.5 is all still there', () => {
    const actions = buildCanvasActions({ ...baseProps, onEditStory: noop, availableViews: ['diagram', 'markdown', 'fable', 'excalidraw', 'lucidchart', 'publication'] });
    const ids = new Set(actions.map((action) => action.id));
    const before = Object.values(BEFORE_12_5).flat();
    expect(before).toHaveLength(28);
    for (const id of before) expect(ids.has(id)).toBe(true);
    expect(Object.keys(CANVAS_ACTION_PLACEMENT).sort()).toEqual([...before].sort());
  });

  it('registers every action in ⌘K under its intent', () => {
    let titles: string[] = [];
    let sections: string[] = [];
    const Probe = () => {
      const { commands } = useCommandPalette();
      titles = commands.map((command) => command.title);
      sections = [...new Set(commands.map((command) => command.section ?? ''))];
      return null;
    };
    render(
      <CommandPaletteProvider>
        <ArtifactBottomToolbar {...baseProps} />
        <Probe />
      </CommandPaletteProvider>,
    );
    expect(titles).toContain('Modo presentación');
    expect(titles).toContain('Traza de generación');
    expect(sections).toEqual(expect.arrayContaining(['Lienzo · Revisar', 'Lienzo · Mejorar', 'Lienzo · Compartir', 'Lienzo · Detalle técnico']));
  });

  // Recomendación 6: visual quality gate tone on the presentation entry.
  describe('presentationGateTone — Visual Quality Gate hint', () => {
    it('uses the neutral description when the gate is ready or undefined', () => {
      render(<ArtifactBottomToolbar {...baseProps} />);
      openMenu('Compartir');
      expect(screen.getByText('Recorrido escena por escena')).toBeInTheDocument();
      expect(screen.queryByText(/Gate bloqueado/i)).not.toBeInTheDocument();
    });

    it('surfaces a warning hint when the gate has advertencias', () => {
      render(<ArtifactBottomToolbar {...baseProps} presentationGateTone="warn" />);
      openMenu('Compartir');
      expect(screen.getByText(/Gate con advertencias/i)).toBeInTheDocument();
    });

    it('surfaces a block hint when the gate is bloqueado', () => {
      render(<ArtifactBottomToolbar {...baseProps} presentationGateTone="block" />);
      openMenu('Compartir');
      expect(screen.getByText(/Gate bloqueado/i)).toBeInTheDocument();
    });
  });
});

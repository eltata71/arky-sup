import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { DiagramView } from '../../../components/artifacts/diagram/DiagramView';
import type { Artifact } from '../../../types';
import type { RenderableDiagramResolution } from '../../../services/diagram/resolveRenderableDiagram';
import type { ReactFlowCanvasHandle } from '../../../components/ReactFlowCanvas';

const artifact: Artifact = {
  id: 'd1',
  versionGroupId: 'd1',
  version: 1,
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

const buildRenderable = (overrides: Partial<RenderableDiagramResolution> = {}): RenderableDiagramResolution => ({
  status: 'ready',
  source: 'artifact.ir',
  ir: null,
  reactFlow: { nodes: [], edges: [] },
  diagnostics: [],
  quality: null,
  warnings: [],
  repairActions: [],
  counters: { baseNodes: 0, projectedNodes: 0, renderNodes: 0, validEdges: 0 },
  qualityGateChanges: [],
  qualityGateReachedTarget: false,
  ...overrides,
});

const noop = () => {};

const baseProps = {
  artifact,
  audience: 'technical' as const,
  isFullscreen: false,
  showMiniMap: false,
  loadingMessage: '',
  displayFlowNodes: [],
  displayFlowEdges: [],
  displayedFlowSource: 'artifact.ir',
  renderableSignature: 'sig-1',
  mermaidCode: 'flowchart LR\n  A --> B',
  renderDiagnosticsSummary: null,
  diagnosticCopied: false,
  onCopyDiagnosticReport: noop,
  // Typed: `createRef()` with no argument is `RefObject<unknown>`, which the
  // prop rejects. It only looked fine while React's types were missing.
  reactFlowRef: React.createRef<ReactFlowCanvasHandle>(),
  onCanvasChange: noop,
  onCancelLoading: noop,
  onAutoFix: noop,
  onRetryDiagram: noop,
  onViewText: noop,
  onResetCanvas: noop,
};

describe('DiagramView', () => {
  it('shows the loading skeleton while the diagram is generating', () => {
    render(
      <DiagramView
        {...baseProps}
        renderable={buildRenderable()}
        isLoading
        loadingMessage="Generando vista interactiva..."
        diagramError={null}
      />,
    );
    expect(screen.getByText('Generando vista interactiva...')).toBeInTheDocument();
  });

  it('renders an actionable error panel when the diagram is invalid', () => {
    render(
      <DiagramView
        {...baseProps}
        renderable={buildRenderable({ status: 'invalid' })}
        isLoading={false}
        diagramError="JSON inválido."
      />,
    );
    expect(screen.getByText('Error al visualizar')).toBeInTheDocument();
    expect(screen.getByText('JSON inválido.')).toBeInTheDocument();
  });

  it('regression: never leaves the canvas blank — shows a diagnostic when there are no visible nodes', () => {
    render(
      <DiagramView
        {...baseProps}
        renderable={buildRenderable()}
        isLoading={false}
        diagramError={null}
      />,
    );
    // No nodes, no error, not loading → still surfaces an actionable panel.
    expect(screen.getByText('Diagrama sin elementos visibles')).toBeInTheDocument();
  });

  it('fires onRetryDiagram from the empty-diagram recovery panel', () => {
    const onRetryDiagram = vi.fn();
    render(
      <DiagramView
        {...baseProps}
        renderable={buildRenderable()}
        isLoading={false}
        diagramError={null}
        onRetryDiagram={onRetryDiagram}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Reintentar/i }));
    expect(onRetryDiagram).toHaveBeenCalledTimes(1);
  });
});

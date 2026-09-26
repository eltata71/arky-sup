import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { FableArtifactView } from '../../../components/artifacts/fable/FableArtifactView';
import {
  getArtifactViewCapabilities,
  resolveSafeArtifactView,
} from '../../../services/artifacts/application/viewController';
import type { Artifact } from '../../../lib/artifacts';
import type { DiagramIR } from '../../../lib/diagram';

const noop = () => {};

const sampleIR: DiagramIR = {
  nodes: [
    { id: 'user', label: 'Cliente Web', kind: 'person', description: 'Usuario final del portal' },
    { id: 'api', label: 'API Gateway', kind: 'gateway', technology: 'Kong' },
    { id: 'db', label: 'Base de Datos', kind: 'database', group: 'core' },
  ],
  edges: [
    { id: 'e1', source: 'user', target: 'api', label: 'HTTPS / REST' },
    { id: 'e2', source: 'api', target: 'db', label: 'consulta', semanticType: 'data-flow' },
  ],
  groups: [{ id: 'core', label: 'Núcleo', nodeIds: ['db'], kind: 'data' }],
  metadata: { title: 'Arquitectura Demo' },
};

const diagramArtifact: Artifact = {
  id: 'a-fable',
  versionGroupId: 'vg',
  version: 1,
  createdAt: '2026-06-11T00:00:00.000Z',
  name: 'Diagrama de contexto',
  type: 'mermaid-graph',
  phase: 'Diseño',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'flowchart LR\n  A --> B',
  objective: 'Visualizar el contexto',
  keyConcepts: [],
  representation: 'diagram',
  ir: sampleIR,
};

const documentArtifact: Artifact = {
  ...diagramArtifact,
  id: 'a-doc',
  type: 'markdown',
  representation: 'document',
  content: '# Documento\n\nSolo texto.',
  ir: undefined,
};

describe('fable view capabilities', () => {
  it('offers the fable view for artifacts with a renderable IR', () => {
    const capabilities = getArtifactViewCapabilities(diagramArtifact);
    expect(capabilities.availableViews).toContain('fable');
    expect(resolveSafeArtifactView(diagramArtifact, 'fable')).toBe('fable');
  });

  it('clamps a fable request on document-only artifacts to a safe view', () => {
    const capabilities = getArtifactViewCapabilities(documentArtifact);
    expect(capabilities.availableViews).not.toContain('fable');
    expect(['document', 'markdown']).toContain(resolveSafeArtifactView(documentArtifact, 'fable'));
  });
});

describe('FableArtifactView', () => {
  it('renders every IR node with the Fable design chrome', () => {
    render(
      <FableArtifactView
        ir={sampleIR}
        artifactName="Diagrama de contexto"
        audience="technical"
        isLoading={false}
        onRetry={noop}
        onSwitchToDocument={noop}
      />,
    );
    expect(screen.getByTestId('fable-canvas')).toBeInTheDocument();
    expect(screen.getByText('Cliente Web')).toBeInTheDocument();
    expect(screen.getByText('API Gateway')).toBeInTheDocument();
    expect(screen.getByText('Base de Datos')).toBeInTheDocument();
    // Header uses the IR title and credits the Anthropic design capability.
    expect(screen.getByText('Arquitectura Demo')).toBeInTheDocument();
    expect(screen.getByText(/IA de Anthropic/i)).toBeInTheDocument();
    expect(screen.getByText(/3 componentes · 2 conexiones/)).toBeInTheDocument();
  });

  it('opens the node detail panel when a node is selected', () => {
    render(
      <FableArtifactView
        ir={sampleIR}
        artifactName="Diagrama de contexto"
        audience="technical"
        isLoading={false}
        onRetry={noop}
        onSwitchToDocument={noop}
      />,
    );
    fireEvent.click(screen.getByTestId('fable-node-api'));
    expect(screen.getByLabelText('Detalle de API Gateway')).toBeInTheDocument();
    expect(screen.getByText(/Conexiones \(2\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Cerrar detalle'));
    expect(screen.queryByLabelText('Detalle de API Gateway')).not.toBeInTheDocument();
  });

  it('shows the empty state with recovery actions when there is no IR', () => {
    const onRetry = vi.fn();
    const onSwitchToDocument = vi.fn();
    render(
      <FableArtifactView
        ir={null}
        artifactName="Sin diagrama"
        audience="technical"
        isLoading={false}
        onRetry={onRetry}
        onSwitchToDocument={onSwitchToDocument}
      />,
    );
    expect(screen.getByText(/aún no tiene un diagrama renderizable/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar diagrama' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ver documento' }));
    expect(onSwitchToDocument).toHaveBeenCalledTimes(1);
  });
});

describe('ArtifactBottomToolbar — Vista Fable entry', () => {
  it('is wired through the Configuración menu (see ArtifactBottomToolbar.test.tsx for menu behaviour)', async () => {
    const { ArtifactBottomToolbar } = await import('../../../components/artifacts/toolbar/ArtifactBottomToolbar');
    const onSelectView = vi.fn();
    render(
      <ArtifactBottomToolbar
        representation="diagram"
        viewMode="diagram"
        availableViews={['diagram', 'split', 'excalidraw', 'lucidchart', 'fable']}
        isDiagramSurface
        hasIR
        onZoomIn={noop}
        onZoomOut={noop}
        onFitView={noop}
        onCenter={noop}
        isFullscreen={false}
        onToggleFullscreen={noop}
        showMiniMap={false}
        onToggleMiniMap={noop}
        onStartPresentation={noop}
        onOpenOnePager={noop}
        audience="technical"
        onChangeAudience={noop}
        isEditMode={false}
        onToggleEdit={noop}
        onSaveDiagram={noop}
        onConvertToDoc={noop}
        onGenerateTests={noop}
        isSpeaking={false}
        onToggleSpeech={noop}
        showQualityPanel={false}
        onToggleQualityPanel={noop}
        hasQualityReport={false}
        onAutoImprove={noop}
        isAutoImproving={false}
        onGenerateWorldClass={noop}
        onOpenSuggestions={noop}
        showTracePanel={false}
        onToggleTracePanel={noop}
        traceErrors={0}
        hasObservabilityAlert={false}
        diagnosticCopied={false}
        hasDiagnosticReport={false}
        onCopyDiagnosticReport={noop}
        onSelectView={onSelectView}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Configuración' }));
    fireEvent.click(screen.getByText('Vista Fable'));
    expect(onSelectView).toHaveBeenCalledWith('fable');
  });
});

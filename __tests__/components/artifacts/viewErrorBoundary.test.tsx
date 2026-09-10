import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';

// Force the inner viewers to crash during render so we can assert that each
// extracted view isolates the failure inside its own ErrorBoundary instead of
// blanking the whole canvas.
vi.mock('../../../components/ExcalidrawViewer', () => ({
  default: () => {
    throw new Error('excalidraw render crash');
  },
}));
vi.mock('../../../components/LucidchartViewer', () => ({
  default: () => {
    throw new Error('lucidchart render crash');
  },
}));

import { ExcalidrawArtifactView } from '../../../components/artifacts/excalidraw/ExcalidrawArtifactView';
import { LucidchartArtifactView } from '../../../components/artifacts/lucidchart/LucidchartArtifactView';

const noop = () => {};

describe('per-view ErrorBoundary isolation', () => {
  it('catches an Excalidraw render crash with a recovery fallback', () => {
    render(
      <ExcalidrawArtifactView
        elements={[]}
        isLoading={false}
        error={null}
        onRetry={noop}
        onOpenExternal={noop}
        onSwitchToDocument={noop}
      />,
    );
    expect(screen.getByText('Excalidraw falló al renderizar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar render/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ver como documento/i })).toBeInTheDocument();
  });

  it('catches a Lucidchart render crash with a recovery fallback', () => {
    render(
      <LucidchartArtifactView
        artifactContent="flowchart LR\nA-->B"
        artifactRepresentation="diagram"
        artifactTitle="Diagrama"
        flowData={null}
        isFlowLoading={false}
        flowError={null}
        onLucidDocumentReady={noop}
        onRetry={noop}
        onOpenExternal={noop}
        onSwitchToDocument={noop}
      />,
    );
    expect(screen.getByText('Lucidchart falló al renderizar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reintentar render/i })).toBeInTheDocument();
  });
});

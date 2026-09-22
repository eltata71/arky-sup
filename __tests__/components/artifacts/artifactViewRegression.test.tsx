import { describe, it, expect } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import {
  getArtifactViewCapabilities,
  resolveSafeArtifactView,
} from '../../../services/artifacts/viewController';

const documentArtifact: Artifact = {
  id: 'doc',
  versionGroupId: 'doc',
  version: 1,
  createdAt: '2026-05-15T00:00:00.000Z',
  name: 'Documento de requisitos',
  type: 'markdown',
  phase: 'Análisis',
  architecturalView: 'Vista Lógica y de Diseño',
  content: '# Requisitos\n\nEl sistema debe permitir...',
  objective: 'Documentar requisitos',
  keyConcepts: [],
  representation: 'document',
};

const hybridArtifact: Artifact = {
  ...documentArtifact,
  id: 'hyb',
  name: 'Flujo BPMN',
  type: 'hybrid-text-diagram',
  representation: 'hybrid',
  content: '# Flujo\n\nNarrativa del proceso.\n\n```mermaid\nflowchart TD\nA-->B\nB-->C\n```',
};

describe('artifact view regressions', () => {
  it('regression: a document artifact never forces a mandatory diagram view', () => {
    const capabilities = getArtifactViewCapabilities(documentArtifact);
    expect(capabilities.availableViews).not.toContain('diagram');
    expect(capabilities.preferredView).not.toBe('diagram');
    // Requesting the diagram view is clamped to a view the artifact can render.
    expect(resolveSafeArtifactView(documentArtifact, 'diagram')).not.toBe('diagram');
  });

  it('regression: a hybrid artifact resolves to a safe, renderable view', () => {
    const capabilities = getArtifactViewCapabilities(hybridArtifact);
    expect(capabilities.hasRenderableDocument).toBe(true);
    expect(capabilities.hasRenderableDiagram).toBe(true);
    // Every requested view stays within what the hybrid artifact can render.
    for (const requested of ['diagram', 'document', 'split', 'markdown'] as const) {
      const safe = resolveSafeArtifactView(hybridArtifact, requested);
      expect(capabilities.availableViews).toContain(safe);
    }
  });

  it('clamps an unrenderable request back to the preferred view', () => {
    const safe = resolveSafeArtifactView(documentArtifact, 'excalidraw');
    expect(['document', 'markdown']).toContain(safe);
  });
});

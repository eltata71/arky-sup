import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import { CopilotSidebar } from '../../components/CopilotSidebar';

// AssistantPanel pulls in the whole app context surface (Firebase, Gemini,
// agent actions...). We are only testing the sidebar's visibility and
// context-handoff behaviour, so we stub the heavy panel with a placeholder.
vi.mock('../../components/AssistantPanel', () => ({
  AssistantPanel: () => <div data-testid="assistant-panel-stub">panel</div>,
}));

const project: Project = {
  id: 'p1',
  name: 'Test Project',
  description: '',
  projectContext: [],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function buildArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'a1',
    versionGroupId: 'a1',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    name: 'Artefacto demo',
    type: 'markdown',
    phase: 'General',
    architecturalView: 'Vista de Gestión y Soporte',
    content: '',
    objective: '',
    keyConcepts: [],
    representation: 'document',
    ...overrides,
  } as Artifact;
}

describe('CopilotSidebar smart handoff', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 });
  });

  it('starts collapsed in every surface by default (product spec)', () => {
    const noop = () => {};

    render(
      <CopilotSidebar
        project={project}
        activeArtifact={null}
        setActiveArtifactId={noop}
        onRequestArtifactGeneration={noop}
      />,
    );

    // Product spec: el Arquitecto Agente debe arrancar colapsado en cada
    // sesión. Solo se abre cuando el usuario lo pide explícitamente.
    expect(screen.queryAllByTestId('assistant-panel-stub')).toHaveLength(0);
    expect(screen.getByLabelText('Arquitecto Agente colapsado')).toBeInTheDocument();
  });

  it('collapses automatically when the architect leaves an artifact and returns to the hub', async () => {
    const artifact = buildArtifact();
    const noop = () => {};

    const { rerender } = render(
      <CopilotSidebar
        project={project}
        activeArtifact={artifact}
        setActiveArtifactId={noop}
        onRequestArtifactGeneration={noop}
      />,
    );

    // Open the panel explicitly so we can verify the auto-collapse contract
    // on the artifact → hub transition.
    // Desktop rail and mobile FAB both expose an "Abrir Arquitecto Agente"
    // button — both toggle the same state, so we click the first match.
    fireEvent.click(screen.getAllByLabelText('Abrir Arquitecto Agente')[0]);
    await waitFor(() => {
      expect(screen.getAllByTestId('assistant-panel-stub').length).toBeGreaterThan(0);
    });

    rerender(
      <CopilotSidebar
        project={project}
        activeArtifact={null}
        setActiveArtifactId={noop}
        onRequestArtifactGeneration={noop}
      />,
    );

    await waitFor(() => {
      expect(screen.queryAllByTestId('assistant-panel-stub')).toHaveLength(0);
    });
    expect(screen.getByLabelText('Arquitecto Agente colapsado')).toBeInTheDocument();
  });

  it('does not auto-collapse a panel the architect explicitly opened on the hub', async () => {
    const noop = () => {};

    render(
      <CopilotSidebar
        project={project}
        activeArtifact={null}
        setActiveArtifactId={noop}
        onRequestArtifactGeneration={noop}
      />,
    );

    // Desktop rail and mobile FAB both expose an "Abrir Arquitecto Agente"
    // button — both toggle the same state, so we click the first match.
    fireEvent.click(screen.getAllByLabelText('Abrir Arquitecto Agente')[0]);
    await waitFor(() => {
      expect(screen.getAllByTestId('assistant-panel-stub').length).toBeGreaterThan(0);
    });

    // The panel was opened on the hub from scratch (no prior artifact). The
    // smart-handoff effect must not undo that.
    expect(screen.getAllByTestId('assistant-panel-stub').length).toBeGreaterThan(0);
  });
});

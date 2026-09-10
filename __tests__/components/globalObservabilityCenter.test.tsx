import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { GlobalObservabilityCenter } from '../../components/GlobalObservabilityCenter';
import { ObservabilityProvider } from '../../context/ObservabilityContext';
import { observabilityService } from '../../services/observability';
import type { Project } from '../../types';

const renderCenter = (project?: Project) => render(
  <ObservabilityProvider>
    <GlobalObservabilityCenter project={project} />
  </ObservabilityProvider>
);

describe('GlobalObservabilityCenter', () => {
  afterEach(() => {
    observabilityService.clear();
  });

  it('shows global health and opens the event drawer', async () => {
    renderCenter();

    expect(await screen.findByRole('button', { name: /abrir centro de monitoreo global/i })).toHaveTextContent(/Sistema estable|Revisar eventos/);
    fireEvent.click(screen.getByRole('button', { name: /abrir centro de monitoreo global/i }));

    expect(screen.getByRole('dialog', { name: /estado operativo de arky/i })).toBeInTheDocument();
    expect(screen.getByText(/monitoreo general de render/i)).toBeInTheDocument();
  });

  it('surfaces a reported error without requiring artifact-specific UI', async () => {
    renderCenter();

    observabilityService.reportError(new Error('canvas blank'), {
      title: 'Error global de JavaScript',
      severity: 'error',
    });

    fireEvent.click(await screen.findByRole('button', { name: /abrir centro de monitoreo global/i }));
    expect(screen.getByText('Error global de JavaScript')).toBeInTheDocument();
    expect(screen.getByText('canvas blank')).toBeInTheDocument();
  });

  it('shows Architecture Office quality gates for the active project', async () => {
    const project: Project = {
      id: 'PROJ-2026-001',
      name: 'ArkyPro',
      description: 'Gestión de arquitectura',
      projectContext: [],
      artifacts: [],
      createdAt: '2026-08-23T00:00:00.000Z',
      updatedAt: '2026-08-23T00:00:00.000Z',
    };
    renderCenter(project);

    fireEvent.click(await screen.findByRole('button', { name: /abrir centro de monitoreo global/i }));
    expect(screen.getByRole('heading', { name: 'Quality gates del proyecto' })).toBeInTheDocument();
    expect(screen.getByText('Security Review')).toBeInTheDocument();
    expect(screen.getAllByText('CONDITIONAL').length).toBeGreaterThan(0);
  });
});

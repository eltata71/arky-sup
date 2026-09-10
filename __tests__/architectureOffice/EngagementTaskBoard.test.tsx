import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EngagementTaskBoard } from '../../components/architectureOffice/EngagementTaskBoard';
import type { OfficeTask } from '../../services/architectureOffice/OfficeTypes';

const task = (overrides: Partial<OfficeTask> & Pick<OfficeTask, 'id' | 'kind' | 'assigneeId' | 'status'>): OfficeTask => ({
  engagementId: 'eng-1',
  title: overrides.id,
  objective: '',
  dependsOn: [],
  acceptanceCriteria: [],
  attempts: 0,
  maxAttempts: 2,
  ...overrides,
});

describe('EngagementTaskBoard', () => {
  it('tells the user there is nothing planned yet', () => {
    render(<EngagementTaskBoard tasks={[]} />);
    expect(screen.getByText(/todavía no tiene tareas/i)).toBeInTheDocument();
  });

  it('groups tasks into the stage they are in and names the accountable persona', () => {
    render(<EngagementTaskBoard tasks={[
      task({ id: 'p1', title: 'Visión de la Arquitectura', kind: 'produce-artifact', assigneeId: 'felipe', reviewerId: 'elena', status: 'in-progress' }),
      task({ id: 'p2', title: 'Modelo de Dominio', kind: 'produce-artifact', assigneeId: 'daniel', status: 'completed' }),
    ]} />);

    expect(screen.getByRole('group', { name: 'Tareas del entregable' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'En curso' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Completadas' })).toBeInTheDocument();
    expect(screen.getByText('Felipe')).toBeInTheDocument();
    expect(screen.getByText('Revisa Elena')).toBeInTheDocument();
    expect(screen.getByText('Daniel')).toBeInTheDocument();
  });

  it('does not render an empty column', () => {
    render(<EngagementTaskBoard tasks={[
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'completed' }),
    ]} />);
    expect(screen.queryByRole('region', { name: 'Retrabajo' })).not.toBeInTheDocument();
  });

  it('surfaces the reviewer verdict and its findings rather than just a colour', () => {
    render(<EngagementTaskBoard tasks={[
      task({
        id: 'r1',
        title: 'Revisión — Visión',
        kind: 'review-artifact',
        assigneeId: 'elena',
        status: 'completed',
        review: {
          reviewerId: 'elena',
          verdict: 'changes-requested',
          summary: 'Faltan elementos obligatorios.',
          deterministicScore: 62,
          findings: [{ severity: 'high', message: 'Falta la sección de riesgos.' }],
          decidedAt: '2026-08-26T00:00:00.000Z',
        },
      }),
    ]} />);

    expect(screen.getByText('Cambios solicitados')).toBeInTheDocument();
    expect(screen.getByText('62/100')).toBeInTheDocument();
    expect(screen.getByText('Falta la sección de riesgos.')).toBeInTheDocument();
    expect(screen.getByText('Alto')).toBeInTheDocument();
  });

  it('explains what a waiting task is waiting for', () => {
    render(<EngagementTaskBoard tasks={[
      task({ id: 'p1', title: 'Contexto C4', kind: 'produce-artifact', assigneeId: 'felipe', status: 'in-progress' }),
      task({ id: 'p2', title: 'Contenedores C4', kind: 'produce-artifact', assigneeId: 'felipe', status: 'pending', dependsOn: ['p1'] }),
    ]} />);

    expect(screen.getByText(/Espera a: Contexto C4/)).toBeInTheDocument();
  });

  it('shows the retry counter once a task has been re-run', () => {
    render(<EngagementTaskBoard tasks={[
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'in-progress', attempts: 2, maxAttempts: 2 }),
    ]} />);
    expect(screen.getByText('Intento 2/2')).toBeInTheDocument();
  });

  it('surfaces the failure reason on a stopped task', () => {
    render(<EngagementTaskBoard tasks={[
      task({ id: 'p1', kind: 'produce-artifact', assigneeId: 'felipe', status: 'failed', error: 'El proveedor de IA no respondió.' }),
    ]} />);
    expect(screen.getByText('El proveedor de IA no respondió.')).toBeInTheDocument();
  });
});

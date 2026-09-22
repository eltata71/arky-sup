import React from 'react';
import { toInitiativeCode } from '../../lib/eaTerminology';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InitiativeCard, InitiativeKpiRow, KpiPanel, DocumentsPanel, OutcomesPanel } from '../../components/businessInitiatives';
import { PortfolioCanvas } from '../../components/navigation/PortfolioCanvas';
import {
  buildInitiative,
  emptyInitiativeRollup,
  type BusinessInitiative,
} from '../../services/businessInitiatives';
import { buildOfficePortfolio } from '../../services/architectureOffice/officePortfolio';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
} from '../../services/architectureOffice/OfficeTypes';
import type { Project } from '../../services/architectureProjects';

const NOW = Date.parse('2026-08-27T12:00:00.000Z');

const initiative = (overrides: Partial<BusinessInitiative> = {}): BusinessInitiative => ({
  ...buildInitiative(
    { title: 'Auto aprobación de pre-autorizaciones', need: 'Necesidad' },
    'user-1',
    [],
    new Date(NOW).toISOString(),
  ),
  ...overrides,
});

describe('InitiativeKpiRow', () => {
  it('says the indicators are unmeasured instead of showing a false zero', () => {
    render(
      <InitiativeKpiRow
        attentionCount={2}
        rollup={{ ...emptyInitiativeRollup(), total: 3, kpisTotal: 4, kpiAttainment: null }}
      />,
    );
    expect(screen.getByText('Sin medir')).toBeInTheDocument();
    expect(screen.getByText(/4 KPI declarado\(s\), ninguno con línea base y meta/)).toBeInTheDocument();
  });

  it('says there are no milestones rather than reporting 0 % met', () => {
    render(<InitiativeKpiRow attentionCount={0} rollup={emptyInitiativeRollup()} />);
    expect(screen.getByText('Sin hitos')).toBeInTheDocument();
  });

  it('surfaces the at-risk count with its cause', () => {
    render(
      <InitiativeKpiRow
        attentionCount={1}
        rollup={{
          ...emptyInitiativeRollup(),
          healthMix: { 'at-risk': 2, active: 0, 'awaiting-decision': 0, realized: 0, idle: 0 },
          overdue: 1,
          milestonesMissed: 3,
        }}
      />,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1 vencida(s) · 3 hito(s) incumplido(s)')).toBeInTheDocument();
  });
});

describe('InitiativeCard', () => {
  it('shows the code, the health and how much architecture serves it', () => {
    render(
      <InitiativeCard
        initiative={initiative({ code: toInitiativeCode('NEG-2026-001') ?? '', status: 'in-progress', driver: 'La regulación exige 48 h.' })}
        attentionCount={3}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('NEG-2026-001')).toBeInTheDocument();
    expect(screen.getByText('La regulación exige 48 h.')).toBeInTheDocument();
    expect(screen.getByText('3 proyecto(s)')).toBeInTheDocument();
  });

  it('names the first gap in an incomplete record', () => {
    render(<InitiativeCard initiative={initiative()} attentionCount={0} onOpen={() => {}} />);
    expect(screen.getByText(/falta Driver \/ motivación/)).toBeInTheDocument();
  });

  it('opens the initiative when clicked', () => {
    const onOpen = vi.fn();
    render(<InitiativeCard initiative={initiative()} attentionCount={0} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});

describe('KpiPanel', () => {
  it('explains why a KPI cannot be plotted instead of drawing an empty bar', () => {
    render(
      <KpiPanel
        initiative={initiative({ kpis: [{ id: 'k', name: 'Tiempo de respuesta', unit: 'min' }] })}
        onPatch={() => {}}
      />,
    );
    expect(screen.getByText(/todavía no se puede medir el avance/i)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('plots the KPI once it has a baseline, a target and a current value', () => {
    render(
      <KpiPanel
        initiative={initiative({
          kpis: [{ id: 'k', name: 'Adopción', unit: '%', baseline: 0, target: 100, current: 40 }],
        })}
        onPatch={() => {}}
      />,
    );
    expect(screen.getByRole('progressbar', { name: 'Avance de Adopción' }))
      .toHaveAttribute('aria-valuenow', '40');
  });

  it('emits a patch rather than a whole initiative when a KPI is added', () => {
    const onPatch = vi.fn();
    render(<KpiPanel initiative={initiative()} onPatch={onPatch} />);
    fireEvent.change(screen.getByLabelText('Indicador'), { target: { value: 'Nuevo KPI' } });
    fireEvent.change(screen.getByLabelText('Unidad'), { target: { value: '%' } });
    fireEvent.click(screen.getByRole('button', { name: '' }));
    expect(onPatch).toHaveBeenCalledOnce();
    const patch = onPatch.mock.calls[0][0];
    expect(Object.keys(patch)).toEqual(['kpis']);
    expect(patch.kpis[0].name).toBe('Nuevo KPI');
  });
});

describe('OutcomesPanel', () => {
  it('flags an outcome nobody agreed how to measure', () => {
    render(
      <OutcomesPanel
        initiative={initiative({ expectedOutcomes: [{ id: 'o', statement: 'Menos rechazos' }] })}
        onPatch={() => {}}
      />,
    );
    expect(screen.getByText(/Falta acordar cómo se evidencia/i)).toBeInTheDocument();
  });
});

describe('DocumentsPanel', () => {
  it('accepts a link or pasted content, and refuses an empty row', () => {
    const onPatch = vi.fn();
    render(<DocumentsPanel initiative={initiative()} onPatch={onPatch} addedBy="Ana" />);

    const add = screen.getByRole('button', { name: /Añadir documento/ });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Nombre del documento'), { target: { value: 'Caso de negocio' } });
    expect(add).toBeDisabled(); // a name alone opens onto nothing

    fireEvent.change(screen.getByLabelText('https://… (donde ya vive el documento)'), { target: { value: 'https://x/doc' } });
    fireEvent.click(add);
    expect(onPatch).toHaveBeenCalledOnce();
    expect(onPatch.mock.calls[0][0].documents[0]).toMatchObject({
      name: 'Caso de negocio',
      url: 'https://x/doc',
      addedBy: 'Ana',
    });
  });

  it('links out to where the document already lives', () => {
    render(
      <DocumentsPanel
        addedBy="Ana"
        onPatch={() => {}}
        initiative={initiative({
          documents: [{
            id: 'd', name: 'Normativa', kind: 'regulation',
            url: 'https://x/norma', addedAt: new Date(NOW).toISOString(), addedBy: 'Ana',
          }],
        })}
      />,
    );
    const link = screen.getByRole('link', { name: 'Normativa' });
    expect(link).toHaveAttribute('href', 'https://x/norma');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
  });
});

describe('PortfolioCanvas', () => {
  const project = (overrides: Partial<Project> & Pick<Project, 'id' | 'name'>): Project => ({
    description: '', projectContext: [], artifacts: [],
    createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  });

  const engagement = (id: string, projectId: string): OfficeEngagement => ({
    id, projectId,
    schemaVersion: OFFICE_ENGAGEMENT_SCHEMA_VERSION,
    title: `Entregable ${id}`,
    brief: 'b',
    businessProjectIds: [],
    initiativeIds: [],
    priority: 'medium',
    status: 'in-progress',
    charter: {
      kind: 'new-solution', objectives: [], scope: [], outOfScope: [], constraints: [],
      regulatoryDrivers: [], deliverables: [], participantIds: [],
      coordinatorId: 'lucia', consolidatorId: 'alejandro',
      provenance: 'deterministic', proposedAt: new Date(NOW).toISOString(),
    },
    tasks: [], arbDecisions: [], budget: { ...DEFAULT_OFFICE_BUDGET }, auditTrail: [],
    createdBy: SYSTEM_OFFICE_ACTOR,
    createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
  });

  const portfolio = buildOfficePortfolio(
    [
      project({ id: 'p1', name: 'Plataforma', linkedBusinessProjects: ['NEG-2026-001'] }),
      project({ id: 'p2', name: 'Laboratorio' }),
    ],
    [engagement('e1', 'p1')],
    { now: NOW },
  );

  const renderCanvas = (overrides = {}) => render(
    <PortfolioCanvas
      initiatives={[initiative({ code: toInitiativeCode('NEG-2026-001') ?? '' })]}
      attentions={portfolio.projects}
      onOpenInitiative={vi.fn()}
      onOpenAttention={vi.fn()}
      onOpenDeliverable={vi.fn()}
      {...overrides}
    />,
  );

  it('lays the three levels out as their own labelled columns', () => {
    renderCanvas();
    expect(screen.getByRole('region', { name: 'Iniciativas de Negocio' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Proyectos de Arquitectura' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Solicitudes de Entregables' })).toBeInTheDocument();
  });

  it('places each item in its own level', () => {
    renderCanvas();
    const initiatives = screen.getByRole('region', { name: 'Iniciativas de Negocio' });
    expect(within(initiatives).getByText('NEG-2026-001')).toBeInTheDocument();

    const attentions = screen.getByRole('region', { name: 'Proyectos de Arquitectura' });
    expect(within(attentions).getByText('Plataforma')).toBeInTheDocument();

    const deliverables = screen.getByRole('region', { name: 'Solicitudes de Entregables' });
    expect(within(deliverables).getByText('Entregable e1')).toBeInTheDocument();
  });

  it('warns about projects that no initiative justifies', () => {
    renderCanvas();
    expect(screen.getByText(/1 proyecto\(s\) sin iniciativa de negocio/)).toBeInTheDocument();
  });

  it('drills into the level that was clicked', () => {
    const onOpenDeliverable = vi.fn();
    renderCanvas({ onOpenDeliverable });
    const deliverables = screen.getByRole('region', { name: 'Solicitudes de Entregables' });
    fireEvent.click(within(deliverables).getByRole('button'));
    expect(onOpenDeliverable).toHaveBeenCalledWith('e1');
  });

  it('invites the first record when the portfolio is empty', () => {
    render(
      <PortfolioCanvas
        initiatives={[]}
        attentions={[]}
        onOpenInitiative={vi.fn()}
        onOpenAttention={vi.fn()}
        onOpenDeliverable={vi.fn()}
      />,
    );
    expect(screen.getByText('El portafolio todavía está vacío')).toBeInTheDocument();
  });
});

describe('PortfolioCanvas — grouping moved to keys', () => {
  const project2 = (overrides: Partial<Project> & Pick<Project, 'id' | 'name'>): Project => ({
    description: '', projectContext: [], artifacts: [],
    createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  });

  const need = initiative({ code: toInitiativeCode('NEG-2026-001') ?? '', title: 'Auto aprobación' });

  const portfolio2 = buildOfficePortfolio(
    [project2({ id: 'p1', name: 'Plataforma', initiativeIds: [need.id] })],
    [],
    { now: NOW, initiatives: [need] },
  );

  it('shows the initiative code on the attention card, never the raw key', () => {
    render(
      <PortfolioCanvas
        initiatives={[need]}
        attentions={portfolio2.projects}
        onOpenInitiative={vi.fn()}
        onOpenAttention={vi.fn()}
        onOpenDeliverable={vi.fn()}
      />,
    );
    const attentions = screen.getByRole('region', { name: 'Proyectos de Arquitectura' });
    expect(within(attentions).getByText('NEG-2026-001')).toBeInTheDocument();
    // The id is the relation, not something a person should ever read.
    expect(within(attentions).queryByText(need.id)).not.toBeInTheDocument();
  });

  it('counts the attentions serving each initiative', () => {
    render(
      <PortfolioCanvas
        initiatives={[need]}
        attentions={portfolio2.projects}
        onOpenInitiative={vi.fn()}
        onOpenAttention={vi.fn()}
        onOpenDeliverable={vi.fn()}
      />,
    );
    const initiatives = screen.getByRole('region', { name: 'Iniciativas de Negocio' });
    expect(within(initiatives).getByText('1 at.')).toBeInTheDocument();
  });
});

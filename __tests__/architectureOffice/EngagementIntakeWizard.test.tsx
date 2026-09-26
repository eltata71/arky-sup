import React from 'react';
import { toInitiativeCode } from '../../lib/eaTerminology';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  EngagementIntakeWizard,
  type EngagementIntakeSubmit,
  type IntakeProjectOption,
} from '../../components/architectureOffice/EngagementIntakeWizard';
import { buildInitiative, type BusinessInitiative } from '../../services/businessInitiatives';
import type { OfficeEngagement } from '../../services/architectureOffice/domain/OfficeTypes';

const BRIEF = 'Modernizar el motor de siniestros AS/400 exponiendo APIs a Salesforce, cumpliendo HIPAA.';
const NOW = '2026-08-26T00:00:00.000Z';

const initiative = (title: string, code: string): BusinessInitiative => ({
  ...buildInitiative({ title, need: 'Necesidad declarada' }, 'user-1', [], NOW),
  code: toInitiativeCode(code) ?? '',
});

const engagement = (projectId: string): OfficeEngagement => ({
  id: 'eng-1',
  projectId,
  schemaVersion: 1,
  title: 'Modernización de siniestros',
  brief: BRIEF,
  businessProjectIds: [],
  initiativeIds: [],
  priority: 'medium' as const,
  status: 'awaiting-charter',
  charter: {
    kind: 'modernization',
    objectives: ['Exponer siniestros como API'],
    scope: [],
    outOfScope: [],
    constraints: [],
    regulatoryDrivers: [],
    deliverables: [{
      templateName: 'Visión de la Arquitectura',
      artifactType: 'markdown',
      assigneeId: 'elena',
      reviewerId: 'felipe',
      rationale: 'Encuadra el encargo antes de bajar al detalle.',
      dependsOnTemplateNames: [],
    }],
    participantIds: ['elena', 'felipe'],
    coordinatorId: 'lucia',
    consolidatorId: 'alejandro',
    provenance: 'deterministic',
    proposedAt: NOW,
  },
  tasks: [],
  arbDecisions: [],
  budget: { maxAiCalls: 40, consumedAiCalls: 0 },
  auditTrail: [],
  createdBy: { id: 'u1', name: 'Ada', role: 'admin' },
  createdAt: NOW,
  updatedAt: NOW,
});

interface Harness {
  projects?: IntakeProjectOption[];
  initiatives?: BusinessInitiative[];
  initialProjectId?: string;
  onPropose?: (input: EngagementIntakeSubmit) => Promise<OfficeEngagement | null>;
}

const setup = ({ projects = [], initiatives = [], initialProjectId, onPropose }: Harness = {}) => {
  const propose = vi.fn(onPropose ?? ((input: EngagementIntakeSubmit) => Promise.resolve(engagement(input.projectId))));
  const approveAndRun = vi.fn(() => Promise.resolve());
  const createAttention = vi.fn();
  const createInitiative = vi.fn();

  render(
    <EngagementIntakeWizard
      open
      initiatives={initiatives}
      projects={projects}
      initialProjectId={initialProjectId}
      onCreateAttention={createAttention}
      onCreateInitiative={createInitiative}
      onPropose={propose}
      onApproveAndRun={approveAndRun}
      onClose={() => {}}
    />,
  );

  return { propose, approveAndRun, createAttention, createInitiative };
};

/*
 * Consultas exactas: cada campo lleva ahora al lado un botón de asistencia cuyo
 * nombre accesible nombra el campo («Sugerir título del entregable con el
 * arquitecto agente»), que es justo lo que un lector de pantalla necesita oír.
 * Un patrón parcial casaría con los dos.
 */
const fillBrief = (title = 'Modernización de siniestros', brief = BRIEF) => {
  fireEvent.change(screen.getByLabelText('Título del entregable'), { target: { value: title } });
  fireEvent.change(screen.getByLabelText('¿Qué necesita el negocio?'), { target: { value: brief } });
};

const chooseProject = (projectId: string) => {
  fireEvent.change(screen.getByLabelText(/Proyecto de arquitectura de destino/i), { target: { value: projectId } });
};

const submitBrief = () => {
  fireEvent.click(screen.getByRole('button', { name: /Proponer plan de trabajo/i }));
};

describe('EngagementIntakeWizard — la jerarquía es obligatoria', () => {
  it('refuses to plan a deliverable that answers no initiative', async () => {
    // A deliverable with no business reason is the exact gap the portfolio
    // graph reports as a finding; the intake must not manufacture it.
    const { propose } = setup({
      projects: [{ id: 'proj-a', name: 'Núcleo de pólizas' }],
      initiatives: [initiative('Siniestros digitales', 'NEG-2026-001')],
    });
    chooseProject('proj-a');
    fillBrief();
    submitBrief();

    expect(await screen.findByText(/iniciativa de negocio que este entregable atiende/i)).toBeInTheDocument();
    expect(propose).not.toHaveBeenCalled();
  });

  it('refuses to plan a deliverable with no project to live in', async () => {
    const first = initiative('Siniestros digitales', 'NEG-2026-001');
    const { propose } = setup({
      projects: [{ id: 'proj-a', name: 'Núcleo de pólizas' }],
      initiatives: [first],
    });
    fireEvent.click(screen.getByRole('option', { name: new RegExp(first.title, 'i') }));
    fillBrief();
    submitBrief();

    expect(await screen.findByText(/proyecto de arquitectura donde vivirá el entregable/i)).toBeInTheDocument();
    expect(propose).not.toHaveBeenCalled();
  });

  it('sends the user to create the level that does not exist yet', () => {
    const { createAttention, createInitiative } = setup();

    fireEvent.click(screen.getByRole('button', { name: /Registrar iniciativa de negocio/i }));
    expect(createInitiative).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Crear proyecto de arquitectura/i }));
    expect(createAttention).toHaveBeenCalledTimes(1);

    // With nothing above it, planning is not merely refused — it is unavailable.
    expect(screen.getByRole('button', { name: /Proponer plan de trabajo/i })).toBeDisabled();
  });

  it('inherits the attention\'s initiative so the two levels cannot disagree', async () => {
    const first = initiative('Siniestros digitales', 'NEG-2026-001');
    const { propose } = setup({
      projects: [{ id: 'proj-a', name: 'Núcleo de pólizas', initiativeIds: [first.id] }],
      initiatives: [first],
    });
    chooseProject('proj-a');
    fillBrief();
    submitBrief();

    await waitFor(() => expect(propose).toHaveBeenCalledTimes(1));
    expect(propose.mock.calls[0][0]).toMatchObject({
      projectId: 'proj-a',
      initiativeIds: [first.id],
      businessProjectIds: ['NEG-2026-001'],
    });
  });

  it('starts on the project it was opened from', async () => {
    const first = initiative('Siniestros digitales', 'NEG-2026-001');
    const { propose } = setup({
      projects: [
        { id: 'proj-a', name: 'Núcleo de pólizas', initiativeIds: [first.id] },
        { id: 'proj-b', name: 'Portal de agentes', initiativeIds: [first.id] },
      ],
      initiatives: [first],
      initialProjectId: 'proj-b',
    });
    fireEvent.click(screen.getByRole('option', { name: new RegExp(first.title, 'i') }));
    fillBrief();
    submitBrief();

    await waitFor(() => expect(propose).toHaveBeenCalledTimes(1));
    expect(propose.mock.calls[0][0]).toMatchObject({ projectId: 'proj-b' });
  });

  it('refuses a brief too thin to plan', async () => {
    const first = initiative('Siniestros digitales', 'NEG-2026-001');
    const { propose } = setup({
      projects: [{ id: 'proj-a', name: 'Núcleo de pólizas', initiativeIds: [first.id] }],
      initiatives: [first],
    });
    chooseProject('proj-a');
    fillBrief('Algo', 'corto');
    submitBrief();

    expect(await screen.findByText(/al menos una frase completa/i)).toBeInTheDocument();
    expect(propose).not.toHaveBeenCalled();
  });

  it('names the destination project once the charter is on screen', async () => {
    const first = initiative('Siniestros digitales', 'NEG-2026-001');
    setup({
      projects: [{ id: 'proj-a', name: 'Núcleo de pólizas', initiativeIds: [first.id] }],
      initiatives: [first],
    });
    chooseProject('proj-a');
    fillBrief();
    submitBrief();

    expect(await screen.findByText(/Proyecto: Núcleo de pólizas/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Aprobar charter y ejecutar/i })).toBeInTheDocument();
  });
});

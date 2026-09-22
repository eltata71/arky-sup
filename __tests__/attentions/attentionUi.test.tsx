import React from 'react';
import { toInitiativeCode } from '../../lib/eaTerminology';
import { type BusinessInitiative, buildInitiative } from '../../services/businessInitiatives';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AttentionCard, AttentionInitiativeGate, AttentionKpiRow } from '../../components/attentions';
import { buildOfficePortfolio } from '../../services/architectureOffice/officePortfolio';
import {
  DEFAULT_OFFICE_BUDGET,
  OFFICE_ENGAGEMENT_SCHEMA_VERSION,
  SYSTEM_OFFICE_ACTOR,
  type OfficeEngagement,
} from '../../services/architectureOffice/OfficeTypes';
import { InitiativeCard } from '../../components/businessInitiatives';
import type { Project } from '../../services/architectureProjects';

const NOW = Date.parse('2026-08-27T12:00:00.000Z');
const ISO = new Date(NOW).toISOString();

const project = (overrides: Partial<Project> & Pick<Project, 'id' | 'name'>): Project => ({
  description: '', projectContext: [], artifacts: [],
  createdAt: ISO, updatedAt: ISO,
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
    provenance: 'deterministic', proposedAt: ISO,
  },
  tasks: [], arbDecisions: [], budget: { ...DEFAULT_OFFICE_BUDGET }, auditTrail: [],
  createdBy: SYSTEM_OFFICE_ACTOR,
  createdAt: ISO, updatedAt: ISO,
});

const need: BusinessInitiative = {
  ...buildInitiative({ title: 'Auto aprobación', need: 'n' }, 'u1', [], ISO),
  code: toInitiativeCode('NEG-2026-001') ?? '',
};

describe('AttentionKpiRow', () => {
  const emptyPortfolio = buildOfficePortfolio([project({ id: 'p1', name: 'Plataforma' })], [], { now: NOW });

  it('says there is no plan instead of reporting 100 % on an empty portfolio', () => {
    render(<AttentionKpiRow portfolio={emptyPortfolio} unlinkedCount={1} servedInitiatives={0} />);

    // An empty rollup ratio is 1 by definition; printing it would claim the
    // work is finished when none was ever planned.
    expect(screen.getByText('Sin plan')).toBeInTheDocument();
    expect(screen.queryByText('100 %')).not.toBeInTheDocument();
  });

  it('names attentions with no declared business reason as a finding', () => {
    render(<AttentionKpiRow portfolio={emptyPortfolio} unlinkedCount={2} servedInitiatives={0} />);
    expect(screen.getByText('Sin iniciativa')).toBeInTheDocument();
    expect(screen.getByText(/sin necesidad de negocio declarada/i)).toBeInTheDocument();
  });

  it('offers the unlinked tile as a filter only when there is something to filter', () => {
    const onFocus = vi.fn();
    const { rerender } = render(
      <AttentionKpiRow portfolio={emptyPortfolio} unlinkedCount={0} servedInitiatives={1} onFocusUnlinked={onFocus} />,
    );
    fireEvent.click(screen.getByText('Sin iniciativa'));
    expect(onFocus).not.toHaveBeenCalled();

    rerender(
      <AttentionKpiRow portfolio={emptyPortfolio} unlinkedCount={3} servedInitiatives={1} onFocusUnlinked={onFocus} />,
    );
    fireEvent.click(screen.getByText('Sin iniciativa'));
    expect(onFocus).toHaveBeenCalledOnce();
  });
});

describe('AttentionCard', () => {
  const portfolio = buildOfficePortfolio(
    [project({ id: 'p1', name: 'Plataforma', description: 'Núcleo de pólizas', initiativeIds: [need.id] })],
    [engagement('e1', 'p1')],
    { now: NOW, initiatives: [need] },
  );
  const node = portfolio.projects[0];

  const renderCard = (overrides: Partial<React.ComponentProps<typeof AttentionCard>> = {}) => render(
    <AttentionCard
      node={node}
      initiatives={[{ id: need.id, code: need.code, title: need.title }]}
      onOpen={() => {}}
      onNewDeliverable={() => {}}
      onLinkInitiative={() => {}}
      {...overrides}
    />,
  );

  it('shows the initiative by its code, never the raw key', () => {
    renderCard();
    expect(screen.getByText('NEG-2026-001')).toBeInTheDocument();
    expect(screen.queryByText(need.id)).not.toBeInTheDocument();
  });

  it('states the missing relation instead of leaving the field blank', () => {
    renderCard({ initiatives: [] });
    expect(screen.getByText('Sin iniciativa de negocio')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vincular iniciativa/i })).toBeInTheDocument();
  });

  it('offers opening a deliverable from the attention that will contain it', () => {
    const onNewDeliverable = vi.fn();
    renderCard({ onNewDeliverable });
    fireEvent.click(screen.getByRole('button', { name: /Nuevo entregable/i }));
    expect(onNewDeliverable).toHaveBeenCalledOnce();
  });

  it('says there is no planned work rather than showing a full bar', () => {
    const empty = buildOfficePortfolio([project({ id: 'p2', name: 'Laboratorio' })], [], { now: NOW });
    renderCard({ node: empty.projects[0], initiatives: [] });
    expect(screen.getByText('Sin trabajo planificado')).toBeInTheDocument();
  });
});

describe('AttentionInitiativeGate', () => {
  const renderGate = (initiatives = [need], overrides = {}) => {
    const onContinue = vi.fn();
    const onCreateInitiative = vi.fn();
    render(
      <AttentionInitiativeGate
        open
        initiatives={initiatives}
        intent="crear la atención"
        onContinue={onContinue}
        onCreateInitiative={onCreateInitiative}
        onClose={() => {}}
        {...overrides}
      />,
    );
    return { onContinue, onCreateInitiative };
  };

  it('will not open an attention until an initiative is chosen', () => {
    const { onContinue } = renderGate();
    const cta = screen.getByRole('button', { name: 'Continuar' });
    expect(cta).toBeDisabled();
    fireEvent.click(cta);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('emits the ids and derives the code mirror from them', () => {
    const { onContinue } = renderGate();
    fireEvent.click(screen.getByRole('option', { name: new RegExp(need.title, 'i') }));
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onContinue).toHaveBeenCalledWith({
      initiativeIds: [need.id],
      codes: ['NEG-2026-001'],
    });
  });

  it('sends the user up a level instead of letting them improvise an initiative', () => {
    const { onCreateInitiative } = renderGate([]);
    expect(screen.getByText(/no hay iniciativas de negocio registradas/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Registrar iniciativa de negocio/i }));
    expect(onCreateInitiative).toHaveBeenCalledOnce();
  });
});

describe('InitiativeCard actions', () => {
  const initiative = need;

  it('makes the title the control, so the card is announced once', () => {
    // The pointer-only overlay used to be a focusable button named after the
    // card, announced immediately before the card's own text — the same
    // content twice. The title is now the single named affordance.
    const onOpen = vi.fn();
    render(<InitiativeCard initiative={initiative} attentionCount={0} onOpen={onOpen} actions={[]} />);
    fireEvent.click(screen.getByRole('button', { name: initiative.title }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: /^Abrir / })).not.toBeInTheDocument();
  });

  it('does not render a menu affordance when there is nothing in it', () => {
    render(<InitiativeCard initiative={initiative} attentionCount={0} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: /Más opciones/i })).not.toBeInTheDocument();
  });

  it('reaches every action by keyboard, which a nested button could not', () => {
    const onSelect = vi.fn();
    render(
      <InitiativeCard
        initiative={initiative}
        attentionCount={0}
        onOpen={() => {}}
        actions={[{ id: 'chat', label: 'Conversar con el equipo', icon: <span />, onSelect }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Más opciones/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Conversar con el equipo' }));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('closes the menu after an action runs, so the list is usable again', () => {
    render(
      <InitiativeCard
        initiative={initiative}
        attentionCount={0}
        onOpen={() => {}}
        actions={[{ id: 'chat', label: 'Conversar con el equipo', icon: <span />, onSelect: () => {} }]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Más opciones/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Conversar con el equipo' }));
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });
});

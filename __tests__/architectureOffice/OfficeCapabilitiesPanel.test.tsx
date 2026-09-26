import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OfficeCapabilitiesPanel } from '../../components/architectureOffice/OfficeCapabilitiesPanel';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/domain/officeAgentPersonas';
import { buildInitiative, type BusinessInitiative } from '../../services/businessInitiatives';
import type { Project } from '../../services/architectureProjects';

const NOW = '2026-08-23T00:00:00.000Z';

const initiative = (code: string, title: string): BusinessInitiative => ({
  ...buildInitiative({ title, need: 'n', code }, 'user-1', [], NOW),
});

const CATALOG = [
  initiative('NEG-2026-001', 'Auto aprobación de pre-autorizaciones'),
  initiative('NEG-2026-002', 'Modernización de siniestros'),
];

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'PROJ-2026-001',
  name: 'ArkyPro',
  description: 'Gestión de arquitectura',
  projectContext: [],
  artifacts: [],
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

describe('OfficeCapabilitiesPanel', () => {
  it('surfaces personas, validators, standards and gates', () => {
    render(
      <OfficeCapabilitiesPanel
        project={project({ initiativeIds: [CATALOG[0].id] })}
        initiatives={CATALOG}
        onChangeInitiativeLinks={() => undefined}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Oficina de Arquitectura' })).toBeInTheDocument();
    expect(screen.getByText(`${Object.keys(OFFICE_AGENT_PERSONAS).length} personas`)).toBeInTheDocument();
    expect(screen.getByText('11 validadores')).toBeInTheDocument();
    expect(screen.getByText('6 quality gates')).toBeInTheDocument();
    expect(screen.getByText('Security Review')).toBeInTheDocument();
  });

  it('links by key and writes the code mirror alongside it', () => {
    const onChange = vi.fn();
    render(
      <OfficeCapabilitiesPanel
        project={project({ initiativeIds: [CATALOG[0].id] })}
        initiatives={CATALOG}
        onChangeInitiativeLinks={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('option', { name: /Modernización de siniestros/ }));

    // The relation is the ids; the codes travel with them so the two cannot drift.
    expect(onChange).toHaveBeenCalledWith({
      initiativeIds: [CATALOG[0].id, CATALOG[1].id],
      codes: ['NEG-2026-001', 'NEG-2026-002'],
    });
  });

  it('cannot emit a link to an initiative that does not exist', () => {
    render(
      <OfficeCapabilitiesPanel
        project={project()}
        initiatives={CATALOG}
        onChangeInitiativeLinks={() => undefined}
      />,
    );
    // Every option is a real record — there is no free-text path any more.
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(CATALOG.length);
    expect(screen.queryByPlaceholderText('NEG-2026-001')).not.toBeInTheDocument();
  });

  it('migrates a legacy code link so it keeps working before it is re-saved', () => {
    render(
      <OfficeCapabilitiesPanel
        project={project({ linkedBusinessProjects: ['NEG-2026-001'] })}
        initiatives={CATALOG}
        onChangeInitiativeLinks={() => undefined}
      />,
    );
    const linked = screen.getByLabelText('Iniciativas de negocio vinculadas');
    expect(linked).toHaveTextContent('Auto aprobación de pre-autorizaciones');
  });

  it('shows a code that matches no initiative instead of dropping it silently', () => {
    const onChange = vi.fn();
    render(
      <OfficeCapabilitiesPanel
        project={project({ linkedBusinessProjects: ['NEG-2026-009'] })}
        initiatives={CATALOG}
        onChangeInitiativeLinks={onChange}
      />,
    );
    const broken = screen.getByLabelText('Vínculos rotos');
    expect(broken).toHaveTextContent('NEG-2026-009');

    fireEvent.click(within(broken).getByRole('button', { name: 'Quitar' }));
    expect(onChange).toHaveBeenCalledWith({ initiativeIds: [], codes: [] });
  });

  it('removes a link without touching the others', () => {
    const onChange = vi.fn();
    render(
      <OfficeCapabilitiesPanel
        project={project({ initiativeIds: [CATALOG[0].id, CATALOG[1].id] })}
        initiatives={CATALOG}
        onChangeInitiativeLinks={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Quitar Auto aprobación de pre-autorizaciones' }));
    expect(onChange).toHaveBeenCalledWith({
      initiativeIds: [CATALOG[1].id],
      codes: ['NEG-2026-002'],
    });
  });

  it('says so when there is nothing to link to yet', () => {
    render(
      <OfficeCapabilitiesPanel
        project={project()}
        initiatives={[]}
        onChangeInitiativeLinks={() => undefined}
      />,
    );
    expect(screen.getByText(/Todavía no hay iniciativas registradas/)).toBeInTheDocument();
  });
});

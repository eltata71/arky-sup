/**
 * La sección de contrato de la ficha (16.5): deriva, diferencias e historial,
 * y sin hallazgos de accesibilidad.
 */
import { render, screen, waitFor } from '@testing-library/react';
import axe from 'axe-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const changes = vi.fn();
vi.mock('../../services/architectureOffice/infrastructure/OfficeAgentProfileRepository', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../services/architectureOffice/infrastructure/OfficeAgentProfileRepository')>();
  return {
    ...original,
    officeAgentProfileRepository: { ...original.officeAgentProfileRepository, changes: (...args: unknown[]) => changes(...args) },
  };
});

import { AgentContractSection } from '../../components/architectureOffice/agentProfile/AgentContractSection';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/domain/officeAgentPersonas';
import type { OfficeAgentProfileOverride } from '../../services/architectureOffice/domain/officeAgentProfile';

const override = (patch: Partial<OfficeAgentProfileOverride> = {}): OfficeAgentProfileOverride => ({
  agentId: 'sofia',
  userId: 'u1',
  schemaVersion: 1,
  definitionVersion: OFFICE_AGENT_PERSONAS.sofia.version,
  alias: 'Sofi',
  knowledge: ['El canal de corredores corre sobre AS/400.'],
  revision: 2,
  updatedAt: '2026-10-22T00:00:00.000Z',
  ...patch,
});

describe('AgentContractSection', () => {
  beforeEach(() => {
    changes.mockReset();
    changes.mockResolvedValue([]);
  });

  it('un agente sin personalizar lo dice y no inventa diferencias', async () => {
    render(<AgentContractSection agentId="sofia" />);
    expect(await screen.findByText(/Sin personalizar/)).toBeInTheDocument();
    expect(screen.getByText(/Sin diferencias/)).toBeInTheDocument();
    expect(await screen.findByText(/Aún no hay cambios registrados/)).toBeInTheDocument();
  });

  it('avisa cuando el producto cambió el contrato después de personalizarlo', async () => {
    const v = OFFICE_AGENT_PERSONAS.sofia.version;
    render(<AgentContractSection agentId="sofia" override={override({ definitionVersion: v + 1 })} />);
    expect(await screen.findByText(new RegExp(`Personalizada contra la v${v + 1}; el agente está en la v${v}`))).toBeInTheDocument();
  });

  it('una personalización anterior al registro de versión no se declara vigente', async () => {
    const { definitionVersion: _drop, ...legacy } = override();
    render(<AgentContractSection agentId="sofia" override={legacy} />);
    expect(await screen.findByText(/antes de registrar la versión del contrato/)).toBeInTheDocument();
  });

  it('lista lo que la organización cambió, con fábrica, organización y efectivo', async () => {
    render(<AgentContractSection agentId="sofia" override={override()} />);
    expect(await screen.findByText('El canal de corredores corre sobre AS/400.')).toBeInTheDocument();
    expect(screen.getAllByText('Fábrica').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Efectivo').length).toBeGreaterThan(0);
  });

  it('muestra el historial de la bitácora', async () => {
    changes.mockResolvedValue([
      { agentId: 'sofia', action: 'save', changedFields: ['alias', 'knowledge'], revision: 2, contractVersion: 1, changedAt: '2026-10-22T10:00:00Z' },
      { agentId: 'sofia', action: 'reset', changedFields: [], revision: 1, contractVersion: null, changedAt: '2026-10-21T10:00:00Z' },
    ]);
    render(<AgentContractSection agentId="sofia" override={override()} />);
    await waitFor(() => expect(screen.getByText('Guardada')).toBeInTheDocument());
    expect(screen.getByText('Vuelta a fábrica')).toBeInTheDocument();
    expect(screen.getByText(/Campos: Nombre, Conocimiento/)).toBeInTheDocument();
    expect(changes).toHaveBeenCalledWith('sofia', 20);
  });

  it('no tiene hallazgos de accesibilidad (axe)', async () => {
    const v = OFFICE_AGENT_PERSONAS.sofia.version;
    changes.mockResolvedValue([
      { agentId: 'sofia', action: 'save', changedFields: ['alias'], revision: 2, contractVersion: v, changedAt: '2026-10-22T10:00:00Z' },
    ]);
    const { container } = render(
      <main>
        <AgentContractSection agentId="sofia" override={override({ definitionVersion: v + 1 })} />
      </main>,
    );
    await screen.findByText('Guardada');
    // jsdom no pinta: el contraste se mide en el E2E (`e2e/accessibility.spec.ts`).
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });
});

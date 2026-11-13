/**
 * El rol que la organización dio a un agente es el que se ve (remediación
 * 21.3 · R3). La carga de especialistas pintaba el rol de fábrica debajo del
 * alias configurado: un agente con dos identidades en la misma tarjeta.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stored = vi.hoisted(() => ({ overrides: [] as unknown[] }));

vi.mock('../../context/AuthContext', () => ({
  useOptionalAuth: () => ({ user: { uid: 'u-1' } }),
}));

vi.mock('../../services/architectureOffice/agentProfilesLoader', async () => {
  const { resolveAgentProfiles } = await import('../../services/architectureOffice/domain/officeAgentProfile');
  return {
    loadResolvedAgentProfiles: vi.fn(async () => resolveAgentProfiles(stored.overrides as never)),
  };
});

import { SpecialistLoadPanel } from '../../components/architectureOffice/dashboard';
import { createAgentProfileOverride } from '../../services/architectureOffice/domain/officeAgentProfile';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/domain/officeAgentPersonas';
import { invalidateLazyAgentProfiles } from '../../hooks/useLazyAgentProfiles';

describe('SpecialistLoadPanel con una ficha configurada', () => {
  beforeEach(() => {
    stored.overrides = [];
    invalidateLazyAgentProfiles();
  });

  it('muestra el alias y el rol de la ficha, no los de fábrica', async () => {
    const created = createAgentProfileOverride({
      agentId: 'felipe', userId: 'u-1', alias: 'Nube propia', role: 'Arquitecto de nube privada',
    });
    if (created.outcome !== 'created') throw new Error(created.message);
    stored.overrides = [created.override];

    render(
      <SpecialistLoadPanel
        specialists={[{ personaId: 'felipe', active: 1, completed: 0, reviewed: 0, activeTaskTitles: ['Contexto C4'] }]}
      />,
    );

    expect(await screen.findByText('Arquitecto de nube privada')).toBeInTheDocument();
    expect(screen.getByText('Nube propia')).toBeInTheDocument();
    expect(screen.queryByText(OFFICE_AGENT_PERSONAS.felipe.role)).not.toBeInTheDocument();
  });
});

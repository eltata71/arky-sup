/**
 * Un agente renombrado se llama así en todas las pantallas (plan de agentes,
 * 16.1 corte 3 · A5).
 *
 * Avatares, chips, tableros y la bitácora leían el alias de fábrica: un agente
 * renombrado en su ficha seguía llamándose como antes en todas partes salvo en
 * la propia ficha.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
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

import { createAgentProfileOverride } from '../../services/architectureOffice/domain/officeAgentProfile';
import { useAgentDisplayName } from '../../hooks/useAgentDisplayName';
import { invalidateLazyAgentProfiles } from '../../hooks/useLazyAgentProfiles';
import { coordinateRequest } from '../../services/architectureOffice/application/officeCoordination';

const renamed = (alias: string) => {
  const created = createAgentProfileOverride({ agentId: 'elena', userId: 'u-1', alias });
  if (created.outcome !== 'created') throw new Error(created.message);
  return created.override;
};

describe('useAgentDisplayName', () => {
  beforeEach(() => {
    stored.overrides = [];
    invalidateLazyAgentProfiles();
  });

  it('da el alias de la ficha y, sin ficha, el de fábrica', async () => {
    stored.overrides = [renamed('Ele')];
    const { result } = renderHook(() => useAgentDisplayName());
    await waitFor(() => expect(result.current('elena')).toBe('Ele'));
    expect(result.current('felipe')).toBe('Felipe');
  });

  it('se entera de que alguien guardó una ficha sin recargar', async () => {
    stored.overrides = [renamed('Ele')];
    const { result } = renderHook(() => useAgentDisplayName());
    await waitFor(() => expect(result.current('elena')).toBe('Ele'));
    stored.overrides = [renamed('Elenita')];
    act(() => { invalidateLazyAgentProfiles(); });
    await waitFor(() => expect(result.current('elena')).toBe('Elenita'));
  });
});

describe('la bitácora de coordinación usa el nombre que se le pase', () => {
  it('escribe a cada agente con su alias configurado', async () => {
    const outcome = await coordinateRequest({
      request: 'Diagrama C4 del portal de siniestros',
      scope: { level: 'project', id: 'p', name: 'Portal', briefing: [] },
      invoke: async () => 'Veredicto: Ready.'.padEnd(240, '.'),
      now: () => 0,
      agentName: (id) => (id === 'lucia' ? 'Lu' : id === 'elena' ? 'Ele' : id),
    });
    const text = outcome.events.map((event) => event.summary).join('\n');
    expect(text).toContain('Lu recibe la solicitud');
    expect(text).not.toContain('Lucía recibe la solicitud');
  });
});

describe('ninguna pantalla lee el alias de fábrica', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

  it('components/ muestra nombres de agente con useAgentDisplayName', () => {
    const offenders = files('components').filter((file) =>
      /OFFICE_AGENT_PERSONAS\[[^\]]+\]\??\.alias/.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});

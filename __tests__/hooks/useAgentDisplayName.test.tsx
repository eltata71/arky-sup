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
import { useAgentDisplayName, useAgentDisplayRole } from '../../hooks/useAgentDisplayName';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/domain/officeAgentPersonas';
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

describe('useAgentDisplayRole', () => {
  beforeEach(() => {
    stored.overrides = [];
    invalidateLazyAgentProfiles();
  });

  it('da el rol de la ficha y, sin ficha, el de fábrica (21.3)', async () => {
    const created = createAgentProfileOverride({ agentId: 'elena', userId: 'u-1', role: 'Arquitecta de plataforma' });
    if (created.outcome !== 'created') throw new Error(created.message);
    stored.overrides = [created.override];
    const { result } = renderHook(() => useAgentDisplayRole());
    await waitFor(() => expect(result.current('elena')).toBe('Arquitecta de plataforma'));
    expect(result.current('felipe')).toBe(OFFICE_AGENT_PERSONAS.felipe.role);
  });
});

/*
 * Ninguna pantalla pinta lo que la ficha configura leyendo la persona de
 * fábrica (16.1 · A5, remediación 21.3 · R3). La regla se escribió para el
 * alias en `components/`, y el rol de dos pantallas se escapó por el hueco:
 * se leía de una variable (`const persona = OFFICE_AGENT_PERSONAS[id]`) o en
 * `pages/`. Así que lo que se cuenta es cualquier lectura de una persona de
 * fábrica en las dos carpetas, y sólo quedan las que tienen razón escrita.
 */
describe('ninguna pantalla lee lo configurable de fábrica', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

  /** Las únicas lecturas permitidas, cada una con su razón. Sólo puede encoger. */
  const ALLOWED: Record<string, { reads: number; reason: string }> = {
    'pages/EngagementRoom.tsx': {
      reads: 2,
      reason: 'el brief para el modelo nombra productor y revisor con el alias de fábrica, que es el que resuelve menciones',
    },
    'components/architectureOffice/OfficeAgentPicker.tsx': {
      reads: 1,
      reason: 'cada botón escribe una mención, y la mención es el alias de fábrica; el rol mostrado viene de la ficha',
    },
  };

  // Una lectura indexada o un recorrido de las personas; contar cuántas hay
  // (`Object.keys(...).length`) no pinta nada configurable.
  const READ = /OFFICE_AGENT_PERSONAS\[|Object\.(?:values|entries)\(\s*OFFICE_AGENT_PERSONAS\s*\)/g;

  it('components/ y pages/ sólo leen la persona de fábrica donde está escrito por qué', () => {
    const found: Record<string, number> = {};
    for (const file of [...files('components'), ...files('pages')]) {
      const code = readFileSync(file, 'utf8').split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n');
      const reads = code.match(READ)?.length ?? 0;
      if (reads > 0) found[file.replace(/\\/g, '/')] = reads;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([file, entry]) => [file, entry.reads])));
  });
});

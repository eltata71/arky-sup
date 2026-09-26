/**
 * Lo que la ficha de un agente hace al leerse de la base.
 *
 * Un documento editado a mano, escrito por una versión anterior o corrompido no
 * puede tumbar la pantalla de agentes: las trece fichas desaparecerían porque
 * una estaba mal. Así que la lectura es defensiva y lo que no reconoce lo
 * descarta — un agente sin ficha se resuelve con sus valores de fábrica, que es
 * exactamente lo que hay que enseñar cuando su configuración es ilegible.
 */

import { describe, expect, it } from 'vitest';
import { normalizeAgentProfileOverride } from '../../services/architectureOffice/infrastructure/OfficeAgentProfileRepository';
import { resolveAgentProfile } from '../../services/architectureOffice/domain/officeAgentProfile';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/domain/officeAgentPersonas';

const stored = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  agentId: 'elena',
  schemaVersion: 1,
  alias: 'Ele',
  knowledge: ['STRIDE en cada diseño'],
  modelTier: 'deep',
  maxConcurrentTasks: 3,
  updatedAt: '2026-09-05T00:00:00.000Z',
  ...overrides,
});

describe('normalizeAgentProfileOverride', () => {
  it('reads a well-formed document', () => {
    const override = normalizeAgentProfileOverride(stored(), 'u1');
    expect(override?.alias).toBe('Ele');
    expect(override?.modelTier).toBe('deep');
    expect(override?.maxConcurrentTasks).toBe(3);
    expect(override?.userId).toBe('u1');
  });

  it('drops a document for an agent that no longer exists', () => {
    expect(normalizeAgentProfileOverride(stored({ agentId: 'quien-sea' }), 'u1')).toBeNull();
    expect(normalizeAgentProfileOverride(null, 'u1')).toBeNull();
    expect(normalizeAgentProfileOverride('texto', 'u1')).toBeNull();
  });

  it('falls back to the shipped value for a tier or a concurrency it does not recognise', () => {
    const override = normalizeAgentProfileOverride(
      stored({ modelTier: 'turbo', maxConcurrentTasks: 99 }),
      'u1',
    );
    expect(override?.modelTier).toBeUndefined();
    expect(override?.maxConcurrentTasks).toBeUndefined();

    // Y lo que se resuelve a partir de ahí es la persona de fábrica, no un
    // valor inventado a medio camino.
    const profile = resolveAgentProfile('elena', override ?? undefined);
    expect(profile.modelTier).toBe('default');
    expect(profile.maxConcurrentTasks).toBe(OFFICE_AGENT_PERSONAS.elena.maxConcurrentTasks);
  });

  it('drops empty strings rather than storing a nameless agent', () => {
    const override = normalizeAgentProfileOverride(stored({ alias: '   ', role: '' }), 'u1');
    expect(override?.alias).toBeUndefined();
    expect(override?.role).toBeUndefined();
    expect(resolveAgentProfile('elena', override ?? undefined).alias)
      .toBe(OFFICE_AGENT_PERSONAS.elena.alias);
  });

  it('keeps a stored `enabled: false`, which is the one boolean that matters', () => {
    expect(normalizeAgentProfileOverride(stored({ enabled: false }), 'u1')?.enabled).toBe(false);
    // Ausente no es `false`: un agente sin la clave está disponible.
    expect(normalizeAgentProfileOverride(stored(), 'u1')?.enabled).toBeUndefined();
    expect(resolveAgentProfile('elena', normalizeAgentProfileOverride(stored(), 'u1') ?? undefined).enabled)
      .toBe(true);
  });
});

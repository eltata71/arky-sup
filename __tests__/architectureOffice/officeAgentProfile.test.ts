/**
 * La ficha de un agente: qué se puede cambiar y qué no.
 *
 * La mitad interesante de estas pruebas es la segunda. Que un alias se guarde
 * es evidente; que **no** se pueda apagar la separación de funciones desde un
 * formulario es la razón por la que la ficha se dividió en dos mitades, y es lo
 * que hay que impedir que alguien "simplifique" más adelante.
 */

import { describe, expect, it } from 'vitest';
import {
  buildAgentProfileBriefing,
  createAgentProfileOverride,
  customizedAgentBriefings,
  disabledAgentIds,
  resolveAgentProfile,
  resolveAgentProfiles,
} from '../../services/architectureOffice/officeAgentProfile';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/officeAgentPersonas';

const at = () => '2026-09-05T00:00:00.000Z';

const overrideFor = (input: Parameters<typeof createAgentProfileOverride>[0]) => {
  const created = createAgentProfileOverride(input, at);
  if (created.outcome !== 'created') throw new Error(`rechazada: ${created.message}`);
  return created.override;
};

describe('createAgentProfileOverride', () => {
  it('refuses an agent that does not exist, with a message a screen can render', () => {
    const created = createAgentProfileOverride({ agentId: 'nadie' as never, userId: 'u1' });
    expect(created.outcome).toBe('rejected');
  });

  it('refuses an alias emptied on purpose, and says how to go back to the default', () => {
    const created = createAgentProfileOverride({ agentId: 'elena', userId: 'u1', alias: '   ' });
    expect(created.outcome).toBe('rejected');
    if (created.outcome !== 'rejected') return;
    expect(created.code).toBe('empty-alias');
    expect(created.message).toMatch(/por defecto/i);
  });

  it('refuses an avatar that is not an emoji: a badge is not a place for markup', () => {
    const created = createAgentProfileOverride({ agentId: 'elena', userId: 'u1', avatar: '<b>E</b>' });
    expect(created.outcome).toBe('rejected');
  });

  it('accepts one or two emoji', () => {
    expect(overrideFor({ agentId: 'elena', userId: 'u1', avatar: '🛡️' }).avatar).toBe('🛡️');
  });

  it('refuses a concurrency outside the range the provider quota tolerates', () => {
    expect(createAgentProfileOverride({ agentId: 'elena', userId: 'u1', maxConcurrentTasks: 9 }).outcome)
      .toBe('rejected');
    expect(createAgentProfileOverride({ agentId: 'elena', userId: 'u1', maxConcurrentTasks: 0 }).outcome)
      .toBe('rejected');
  });

  it('stores nothing for a field left alone, so a later release still reaches the agent', () => {
    const override = overrideFor({ agentId: 'elena', userId: 'u1', memory: ['Una regla'] });
    // Guardar los valores por defecto los congelaría: la próxima versión que
    // mejore la instrucción de Elena no llegaría a quien abrió su ficha una vez.
    expect(override.alias).toBeUndefined();
    expect(override.role).toBeUndefined();
    expect(override.instruction).toBeUndefined();
  });

  it('drops duplicates and blank entries from a list', () => {
    const override = overrideFor({
      agentId: 'elena',
      userId: 'u1',
      knowledge: ['ACORD', '  ', 'acord', 'STRIDE'],
    });
    expect(override.knowledge).toEqual(['ACORD', 'STRIDE']);
  });
});

describe('resolveAgentProfile', () => {
  it('returns the shipped persona when nothing is configured', () => {
    const profile = resolveAgentProfile('sofia');
    expect(profile.alias).toBe(OFFICE_AGENT_PERSONAS.sofia.alias);
    expect(profile.customized).toBe(false);
    expect(profile.enabled).toBe(true);
  });

  it('adds organisation skills instead of replacing what the agent knows', () => {
    const profile = resolveAgentProfile('sofia', overrideFor({
      agentId: 'sofia',
      userId: 'u1',
      skills: ['Canal de corredores'],
    }));

    // Enseñarle a Sofía el canal de corredores no puede hacerle olvidar ACORD.
    expect(profile.skills).toContain('insurance');
    expect(profile.skills).toContain('Canal de corredores');
    expect(profile.customized).toBe(true);
  });

  it('never lets configuration touch who produces and who reviews', () => {
    const profile = resolveAgentProfile('elena', overrideFor({
      agentId: 'elena',
      userId: 'u1',
      alias: 'Ele',
      // Aunque alguien intente colar estos campos, el tipo de entrada no los
      // admite y la resolución los toma siempre de la persona de fábrica.
    }));

    expect(profile.producesArtifactTypes).toEqual(OFFICE_AGENT_PERSONAS.elena.producesArtifactTypes);
    expect(profile.reviewsArtifactTypes).toEqual(OFFICE_AGENT_PERSONAS.elena.reviewsArtifactTypes);
    expect(profile.orchestrationRole).toBe(OFFICE_AGENT_PERSONAS.elena.orchestrationRole);
  });

  it('ignores an override that belongs to another agent', () => {
    const profile = resolveAgentProfile('elena', overrideFor({ agentId: 'sofia', userId: 'u1', alias: 'Sof' }));
    expect(profile.alias).toBe(OFFICE_AGENT_PERSONAS.elena.alias);
  });

  it('resolves the whole cast, configured or not', () => {
    const profiles = resolveAgentProfiles([overrideFor({ agentId: 'carmen', userId: 'u1', enabled: false })]);
    expect(profiles).toHaveLength(Object.keys(OFFICE_AGENT_PERSONAS).length);
    expect(disabledAgentIds(profiles)).toEqual(['carmen']);
  });
});

describe('buildAgentProfileBriefing', () => {
  it('states who the agent is, what it knows and what it must remember', () => {
    const briefing = buildAgentProfileBriefing(resolveAgentProfile('carmen', overrideFor({
      agentId: 'carmen',
      userId: 'u1',
      knowledge: ['Operamos bajo Solvencia II desde 2024'],
      memory: ['Ninguna decisión sin control identificado'],
    })));

    const text = briefing.join('\n');
    expect(text).toContain('Carmen');
    expect(text).toContain('Solvencia II desde 2024');
    expect(text).toContain('Ninguna decisión sin control identificado');
  });

  it('briefs only the customised agents: the rest already get their shipped instruction', () => {
    const profiles = resolveAgentProfiles([overrideFor({ agentId: 'felipe', userId: 'u1', alias: 'Fel' })]);
    const briefings = customizedAgentBriefings(profiles);

    expect(Object.keys(briefings)).toEqual(['felipe']);
  });
});

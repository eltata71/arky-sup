/**
 * Un solo compositor de la voz de un agente, en capas (plan de agentes, 16.0).
 *
 * Había dos —la persona de fábrica en el sistema y la ficha antepuesta al
 * mensaje— y un agente personalizado recibía las dos, con la segunda sin su
 * alcance ni su frontera (A2, A3). Estas pruebas fijan la forma del prompt, no
 * su redacción: una identidad, la frontera siempre, la capa de la organización
 * subordinada y vallada en lo que son datos, y las reglas al final.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UNTRUSTED_FENCE_OPEN, hasUntrustedFence } from '../../lib/untrustedContent';
import {
  AGENT_PROMPT_LAYERS,
  OFFICE_RULES_LINE,
  composeAgentInstruction,
} from '../../services/architectureOffice/domain/agentPromptComposer';
import {
  createAgentProfileOverride,
  resolveAgentProfile,
  type OfficeAgentProfileInput,
} from '../../services/architectureOffice/domain/officeAgentProfile';
import { listAgents } from '../../services/architectureOffice/domain/agentRegistry';
import { buildOfficePersonaBriefing } from '../../services/architectureOffice/domain/officePersonaBriefing';

const customized = (input: Omit<OfficeAgentProfileInput, 'userId'>) => {
  const created = createAgentProfileOverride({ userId: 'u1', ...input });
  if (created.outcome !== 'created') throw new Error(created.message);
  return resolveAgentProfile(input.agentId, created.override);
};

const count = (text: string, needle: string): number => text.split(needle).length - 1;

describe('composeAgentInstruction', () => {
  it.each(listAgents().map((agent) => agent.id))('%s: una identidad, su frontera y las reglas al final', (agentId) => {
    const text = composeAgentInstruction('BASE', resolveAgentProfile(agentId));
    expect(count(text, 'Eres ')).toBe(1);
    expect(text.startsWith('BASE')).toBe(true);
    expect(text).toContain('Te ocupas de:');
    expect(text).toContain('No te ocupas de:');
    expect(text.trimEnd().endsWith(OFFICE_RULES_LINE)).toBe(true);
    // Sin ficha guardada no hay capa de la organización que mostrar.
    expect(text).not.toContain(AGENT_PROMPT_LAYERS.organization);
  });

  it('un agente personalizado sigue teniendo una sola identidad, la configurada', () => {
    const text = composeAgentInstruction('BASE', customized({ agentId: 'sofia', alias: 'Sof', knowledge: ['Corredores en AS/400.'] }));
    expect(count(text, 'Eres ')).toBe(1);
    expect(text).toContain('Eres Sof,');
    expect(text).toContain('No te ocupas de:');
  });

  it('las capas van en orden fijo: contrato, organización, reglas', () => {
    const text = composeAgentInstruction('BASE', customized({
      agentId: 'carmen',
      instruction: 'Cita la norma aplicable en cada hallazgo.',
      knowledge: ['Operamos bajo Solvencia II.'],
    }));
    const contract = text.indexOf(AGENT_PROMPT_LAYERS.contract);
    const organization = text.indexOf(AGENT_PROMPT_LAYERS.organization);
    const rules = text.indexOf(AGENT_PROMPT_LAYERS.rules);
    expect(contract).toBeGreaterThan(0);
    expect(organization).toBeGreaterThan(contract);
    expect(rules).toBeGreaterThan(organization);
  });

  it('la instrucción de la organización se añade a la del producto, subordinada', () => {
    const profile = customized({ agentId: 'carmen', instruction: 'Cita la norma aplicable en cada hallazgo.' });
    const text = composeAgentInstruction('BASE', profile);
    expect(text).toContain(profile.instruction);
    const added = text.indexOf('Cita la norma aplicable');
    expect(added).toBeGreaterThan(text.indexOf(AGENT_PROMPT_LAYERS.organization));
    expect(text).toContain('mandan ellos');
  });

  it('el conocimiento y la memoria de la ficha viajan vallados', () => {
    const text = composeAgentInstruction('BASE', customized({
      agentId: 'daniel',
      knowledge: ['El datamart de reservas se recalcula cada noche.'],
      memory: ['No mover datos actuariales fuera de la región.'],
    }));
    expect(hasUntrustedFence(text)).toBe(true);
    const fence = text.indexOf(UNTRUSTED_FENCE_OPEN);
    expect(text.indexOf('El datamart de reservas')).toBeGreaterThan(fence);
    expect(text.indexOf('No mover datos actuariales')).toBeGreaterThan(fence);
  });

  it('el briefing del agente usa el mismo compositor con la ficha que recibe', () => {
    const profile = customized({ agentId: 'felipe', knowledge: ['Cuentas por línea de negocio.'] });
    const composed = buildOfficePersonaBriefing('felipe', profile).composeInstruction('BASE');
    expect(composed).toBe(composeAgentInstruction('BASE', profile));
    // Una ficha de otro agente no se le aplica.
    expect(buildOfficePersonaBriefing('carmen', profile).composeInstruction('BASE')).toContain('Eres Carmen,');
  });
});

describe('nadie más compone la identidad de un agente', () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/.test(name) ? [path] : [];
  });

  it('«Actúas como» y «Eres … agente de la Oficina» sólo existen en el compositor', () => {
    const offenders = files('services').filter((file) => {
      if (file.endsWith('agentPromptComposer.ts')) return false;
      const code = readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*\*)/.test(line)).join('\n');
      return /Actúas como|agente de la Oficina de Arquitectura de Arky/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});

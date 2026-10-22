/**
 * Deriva del contrato y diferencias de fábrica (plan de agentes 16.5).
 */
import { describe, expect, it } from 'vitest';
import {
  createAgentProfileOverride,
  type OfficeAgentProfileOverride,
} from '../../services/architectureOffice/domain/officeAgentProfile';
import {
  describeContractDrift,
  describeProfileDifferences,
} from '../../services/architectureOffice/domain/agentProfileDrift';
import { OFFICE_AGENT_PERSONAS } from '../../services/architectureOffice/domain/officeAgentPersonas';
import { normalizeAgentProfileOverride } from '../../services/architectureOffice/infrastructure/OfficeAgentProfileRepository';

const created = (input: Parameters<typeof createAgentProfileOverride>[0]): OfficeAgentProfileOverride => {
  const result = createAgentProfileOverride(input, () => '2026-10-22T00:00:00.000Z');
  if (result.outcome !== 'created') throw new Error('la fábrica rechazó el caso de prueba');
  return result.override;
};

describe('versión del contrato al guardar', () => {
  it('la fábrica estampa la versión vigente del agente', () => {
    const override = created({ agentId: 'elena', userId: 'u1', alias: 'Ele' });
    expect(override.definitionVersion).toBe(OFFICE_AGENT_PERSONAS.elena.version);
  });

  it('la lectura conserva una versión válida y descarta una inválida', () => {
    const base = { agentId: 'elena', schemaVersion: 1, updatedAt: '2026-10-22T00:00:00.000Z' };
    expect(normalizeAgentProfileOverride({ ...base, definitionVersion: 3 }, 'u1')?.definitionVersion).toBe(3);
    expect(normalizeAgentProfileOverride({ ...base, definitionVersion: 0 }, 'u1')?.definitionVersion).toBeUndefined();
    expect(normalizeAgentProfileOverride({ ...base, definitionVersion: 1.5 }, 'u1')?.definitionVersion).toBeUndefined();
    expect(normalizeAgentProfileOverride({ ...base }, 'u1')?.definitionVersion).toBeUndefined();
  });
});

describe('describeContractDrift', () => {
  const current = OFFICE_AGENT_PERSONAS.elena.version;

  it('sin ficha guardada no hay nada contra lo que haber derivado', () => {
    expect(describeContractDrift('elena')).toEqual({ status: 'not-customized', current });
  });

  it('una ficha de la versión vigente está al día', () => {
    const override = created({ agentId: 'elena', userId: 'u1', alias: 'Ele' });
    expect(describeContractDrift('elena', override)).toEqual({ status: 'current', customizedAgainst: current, current });
  });

  it('una ficha escrita contra otra versión ha derivado, y dice contra cuál', () => {
    const override = { ...created({ agentId: 'elena', userId: 'u1', alias: 'Ele' }), definitionVersion: current + 1 };
    expect(describeContractDrift('elena', override)).toEqual({ status: 'drifted', customizedAgainst: current + 1, current });
    const older = { ...override, definitionVersion: Math.max(1, current - 1) };
    if (current > 1) expect(describeContractDrift('elena', older).status).toBe('drifted');
  });

  it('una ficha sin versión registrada no se declara vigente', () => {
    const { definitionVersion: _version, ...legacy } = created({ agentId: 'elena', userId: 'u1', alias: 'Ele' });
    expect(describeContractDrift('elena', legacy)).toEqual({ status: 'unrecorded', current });
  });

  it('el override de otro agente no cuenta', () => {
    const override = created({ agentId: 'carmen', userId: 'u1', alias: 'Car' });
    expect(describeContractDrift('elena', override).status).toBe('not-customized');
  });
});

describe('describeProfileDifferences', () => {
  it('sin ficha no hay diferencias', () => {
    expect(describeProfileDifferences('elena')).toEqual([]);
  });

  it('un escalar sustituido muestra fábrica, organización y efectivo', () => {
    const override = created({ agentId: 'elena', userId: 'u1', alias: 'Ele', maxConcurrentTasks: 4 });
    const alias = describeProfileDifferences('elena', override).find((entry) => entry.field === 'alias');
    expect(alias).toEqual({
      kind: 'replaces',
      field: 'alias',
      factory: OFFICE_AGENT_PERSONAS.elena.alias,
      organization: 'Ele',
      effective: 'Ele',
    });
    const tasks = describeProfileDifferences('elena', override).find((entry) => entry.field === 'maxConcurrentTasks');
    expect(tasks?.kind).toBe('replaces');
  });

  it('un valor guardado que coincide con el de fábrica no es una diferencia', () => {
    const override = created({
      agentId: 'elena',
      userId: 'u1',
      alias: OFFICE_AGENT_PERSONAS.elena.alias,
      maxConcurrentTasks: OFFICE_AGENT_PERSONAS.elena.maxConcurrentTasks,
    });
    expect(describeProfileDifferences('elena', override)).toEqual([]);
  });

  it('lo que se añade se lista aparte de lo que trae el producto', () => {
    const override = created({
      agentId: 'sofia',
      userId: 'u1',
      knowledge: ['El canal de corredores corre sobre AS/400.'],
      skills: ['reaseguro-facultativo'],
      instruction: 'Cita siempre la póliza.',
    });
    const differences = describeProfileDifferences('sofia', override);
    const skills = differences.find((entry) => entry.field === 'skills');
    expect(skills).toMatchObject({ kind: 'adds', added: ['reaseguro-facultativo'] });
    expect(skills && skills.kind === 'adds' && skills.inherited).toBeGreaterThan(0);
    expect(differences.find((entry) => entry.field === 'knowledge')).toMatchObject({ kind: 'adds', inherited: 0 });
    expect(differences.find((entry) => entry.field === 'instruction')).toMatchObject({ kind: 'adds', added: ['Cita siempre la póliza.'] });
  });
});

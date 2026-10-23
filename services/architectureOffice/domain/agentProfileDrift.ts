/**
 * Cuándo el producto cambió un agente que una organización personalizó, y qué
 * cambió ella (plan de agentes 16.5).
 *
 * Un override se escribe contra una versión del contrato del agente
 * (`AgentDefinition.version`). Si el producto sube esa versión, lo que la
 * organización añadió —conocimiento, memoria, una instrucción— sigue aplicando
 * sobre un contrato que ya no es el que tenía delante al escribirlo. Eso no se
 * arregla solo y tampoco es un error: es algo que alguien debe poder ver.
 *
 * Todo aquí es puro y no lleva texto de pantalla: devuelve hechos y la hoja los
 * redacta. Una frase en el dominio es una frase que no se traduce.
 */

import type { OfficeAgentId } from './officeAgentPersonas';
import { OFFICE_AGENT_PERSONAS } from './officeAgentPersonas';
import {
  resolveAgentProfile,
  type OfficeAgentProfileOverride,
} from './officeAgentProfile';

export type ContractDrift =
  | { status: 'not-customized'; current: number }
  /** Personalizada contra la versión vigente. */
  | { status: 'current'; customizedAgainst: number; current: number }
  /** El producto cambió el contrato desde que se personalizó. */
  | { status: 'drifted'; customizedAgainst: number; current: number }
  /** Personalizada antes de registrar la versión: no se sabe contra cuál. */
  | { status: 'unrecorded'; current: number };

export const describeContractDrift = (
  agentId: OfficeAgentId,
  override?: OfficeAgentProfileOverride,
): ContractDrift => {
  const current = OFFICE_AGENT_PERSONAS[agentId].version;
  if (!override || override.agentId !== agentId) return { status: 'not-customized', current };
  const recorded = override.definitionVersion;
  // Un override sin versión no se declara «vigente» por defecto: eso sería
  // afirmar algo que nadie midió.
  if (recorded === undefined) return { status: 'unrecorded', current };
  return recorded === current
    ? { status: 'current', customizedAgainst: recorded, current }
    : { status: 'drifted', customizedAgainst: recorded, current };
};

export type ScalarProfileField = 'alias' | 'role' | 'avatar' | 'modelTier' | 'maxConcurrentTasks' | 'enabled';
export type AdditiveProfileField = 'instruction' | 'skills' | 'knowledge' | 'memory';

/** Un campo que la organización sustituye: tres valores, uno por capa. */
export interface ReplacedDifference {
  kind: 'replaces';
  field: ScalarProfileField;
  factory: string | number | boolean | undefined;
  organization: string | number | boolean;
  effective: string | number | boolean | undefined;
}

/** Un campo al que la organización añade: lo añadido, y cuánto trae el producto. */
export interface AddedDifference {
  kind: 'adds';
  field: AdditiveProfileField;
  added: string[];
  inherited: number;
}

export type ProfileDifference = ReplacedDifference | AddedDifference;

const SCALARS: readonly ScalarProfileField[] = ['alias', 'role', 'avatar', 'modelTier', 'maxConcurrentTasks', 'enabled'];

/**
 * Fábrica / organización / efectivo, campo a campo.
 *
 * Sólo aparece lo que la organización tocó **y** cambia el resultado: un valor
 * guardado que coincide con el de fábrica es ruido que no informa de nada.
 */
export const describeProfileDifferences = (
  agentId: OfficeAgentId,
  override?: OfficeAgentProfileOverride,
): ProfileDifference[] => {
  if (!override || override.agentId !== agentId) return [];
  const factory = resolveAgentProfile(agentId);
  const effective = resolveAgentProfile(agentId, override);
  const differences: ProfileDifference[] = [];

  for (const field of SCALARS) {
    const organization = override[field];
    if (organization === undefined) continue;
    if (factory[field] === effective[field]) continue;
    differences.push({
      kind: 'replaces',
      field,
      factory: factory[field],
      organization,
      effective: effective[field],
    });
  }

  if (override.instruction) {
    differences.push({ kind: 'adds', field: 'instruction', added: [override.instruction], inherited: 1 });
  }
  const inherited = {
    skills: factory.skills.length,
    knowledge: factory.knowledge.length,
    memory: factory.memory.length,
  };
  for (const field of ['skills', 'knowledge', 'memory'] as const) {
    const added = override[field];
    if (added && added.length > 0) differences.push({ kind: 'adds', field, added: [...added], inherited: inherited[field] });
  }
  return differences;
};

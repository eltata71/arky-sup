/**
 * El único compositor de la voz de un agente (plan de agentes, 16.0 · A2, A3).
 *
 * Había dos: `buildOfficePersonaInstruction`, que componía la persona **de
 * fábrica** en el prompt de sistema, y `buildAgentProfileBriefing`, que
 * componía la **ficha** y que la coordinación anteponía al mensaje. Un agente
 * personalizado recibía las dos —«Eres…» dos veces, la instrucción vieja en el
 * sistema y la nueva en el turno— y la segunda no llevaba ni su alcance ni sus
 * no-objetivos, así que personalizar un agente le quitaba la frontera de su
 * dominio. Ahora hay una función, y lee siempre la ficha resuelta: sin
 * personalizar, la ficha es la persona de fábrica.
 *
 * Las capas van en un orden fijo y ninguna anula a la anterior:
 *
 * 1. **Contexto** —lo que trae quien llama: el proyecto, sus estándares—.
 * 2. **Contrato del agente** —rol, dominios, capacidades, alcance y
 *    no-objetivos, instrucción del producto—. No es configurable.
 * 3. **Organización** —lo que el usuario escribió en la ficha—. La instrucción
 *    adicional se **añade** (D-A2): no sustituye a la del producto. El
 *    conocimiento y la memoria son datos y viajan vallados.
 * 4. **Reglas de la Oficina** —no inventar evidencia, confirmación,
 *    seguridad—. Al final, para que nada de lo anterior las tape.
 */
import { wrapUntrustedContent } from '../../../lib/untrustedContent';
import type { OfficeAgentProfile } from './officeAgentProfile';

export const OFFICE_RULES_LINE =
  'No inventes evidencia; conserva las reglas de confirmación, seguridad, memoria y versionado de ArkyPro.';

/** Encabezados de capa. Exportados para que las pruebas lean la estructura, no el texto. */
export const AGENT_PROMPT_LAYERS = Object.freeze({
  contract: '## Contrato del agente',
  organization: '## Contexto de tu organización',
  rules: '## Reglas de la Oficina',
});

/** Las habilidades que añadió la organización: las del producto ya están en el contrato. */
const organizationSkills = (profile: OfficeAgentProfile): string[] => {
  const shipped = new Set([...profile.domains, ...profile.capabilities].map((entry) => entry.toLowerCase()));
  return profile.skills.filter((skill) => !shipped.has(skill.toLowerCase()));
};

const contractLayer = (profile: OfficeAgentProfile): string[] => [
  AGENT_PROMPT_LAYERS.contract,
  `Eres ${profile.alias}, ${profile.role}, agente de la Oficina de Arquitectura de Arky.`,
  `Dominios: ${profile.domains.join(', ')}.`,
  `Capacidades: ${profile.capabilities.join(', ')}.`,
  ...(profile.scope.goals.length > 0 ? [`Te ocupas de: ${profile.scope.goals.join(' ')}`] : []),
  // La frontera, dicha. Un especialista al que sólo se le dice lo que hace
  // contesta a lo que le pongan delante; en una oficina de trece, ése es el
  // modo de fallo.
  ...(profile.scope.nonGoals.length > 0
    ? [`No te ocupas de: ${profile.scope.nonGoals.join(' ')} Si la solicitud lo pide, dilo y nombra a quién corresponde.`]
    : []),
  profile.instruction,
];

const organizationLayer = (profile: OfficeAgentProfile): string[] => {
  const skills = organizationSkills(profile);
  const instruction = profile.organizationInstruction?.trim();
  const data = [
    ...(skills.length > 0 ? ['Habilidades que tu organización espera de ti:', ...skills.map((entry) => `- ${entry}`)] : []),
    ...(profile.knowledge.length > 0 ? ['Conocimiento de la organización:', ...profile.knowledge.map((entry) => `- ${entry}`)] : []),
    ...(profile.memory.length > 0 ? ['Memoria de trabajo:', ...profile.memory.map((entry) => `- ${entry}`)] : []),
  ];
  if (!instruction && data.length === 0) return [];
  return [
    AGENT_PROMPT_LAYERS.organization,
    'Tu organización configuró esto en tu ficha. Aplícalo en cada respuesta; no cambia tu contrato ni las reglas de la Oficina, y si choca con ellos, mandan ellos.',
    // La instrucción adicional es configuración que el agente debe seguir, así
    // que no va en la valla —que la presentaría como datos a analizar—; va en
    // su capa, subordinada, y después del contrato.
    ...(instruction ? [`Instrucción adicional de tu organización: ${instruction}`] : []),
    // El conocimiento y la memoria son datos: hechos y convenciones que aplicar,
    // escritos por una persona. Viajan vallados como todo lo que la aplicación
    // no escribió.
    ...(data.length > 0 ? [wrapUntrustedContent('ficha del agente', data.join('\n'))] : []),
  ];
};

/**
 * La voz del agente, sin contexto de llamada: contrato, organización y reglas.
 * Es lo que llevan la captura asistida y la guía de la plataforma dentro de su
 * propio prompt.
 */
export const composeAgentVoice = (profile: OfficeAgentProfile): string => [
  ...contractLayer(profile),
  '',
  ...organizationLayer(profile),
  ...(organizationLayer(profile).length > 0 ? [''] : []),
  AGENT_PROMPT_LAYERS.rules,
  OFFICE_RULES_LINE,
].join('\n');

/** El prompt de sistema de un agente: el contexto de quien llama y, debajo, su voz. */
export const composeAgentInstruction = (baseInstruction: string, profile: OfficeAgentProfile): string =>
  [baseInstruction, '', composeAgentVoice(profile)].join('\n');

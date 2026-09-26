/**
 * Cómo se le pregunta algo a la Oficina desde una pantalla.
 *
 * `ProjectCopilotChatModal` construía a mano el `CoordinationScope` de un
 * proyecto —su briefing, su ascendencia de iniciativas—, montaba el invocador,
 * llamaba a `coordinateRequest` y componía la línea de atribución con los
 * alias de los especialistas. Cien líneas de política de producto dentro de un
 * `useCallback` de un modal, y la única forma de comprobarlas era abrir el
 * modal.
 *
 * Lo que decide este fichero:
 *
 * - **Qué sabe la Oficina del proyecto al responder.** El briefing lleva la
 *   descripción y el contexto capturado; la ascendencia lleva las iniciativas
 *   a las que responde. Un proyecto preguntado sin su iniciativa pierde la
 *   razón por la que existe, que es lo que `CLAUDE.md` pide que viaje con cada
 *   prompt.
 * - **Cómo se firma la respuesta.** La firman los especialistas, no el
 *   coordinador: la premisa del producto es que el asistente es el mostrador
 *   de una oficina, y quien responde es el equipo. Cuando algún especialista
 *   no entrega, se dice — una respuesta parcial presentada como completa es
 *   peor que una que avisa.
 */

import type { Settings } from '../../../types';
import type { Project } from '../../architectureProjects';
import type { BusinessInitiative } from '../../businessInitiatives';
import { coordinateRequest, type CoordinationScope } from './officeCoordination';
import { buildCoordinationInvoker } from './officeCoordinationInvoker';
import { OFFICE_AGENT_PERSONAS } from '../domain/officeAgentPersonas';

/** Lo que la Oficina sabe del proyecto mientras responde. */
export const buildProjectScope = (
  project: Project,
  initiatives: readonly BusinessInitiative[],
): CoordinationScope => {
  const linked = initiatives.filter(
    (candidate) => (project.initiativeIds ?? []).includes(candidate.id),
  );
  return {
    level: 'project',
    id: project.id,
    name: project.name,
    briefing: [
      `Descripción: ${project.description}`,
      ...(project.projectContext.length > 0
        ? [`Contexto: ${project.projectContext.join('; ')}`]
        : []),
    ],
    ancestry: linked.map((candidate) => ({
      level: 'initiative' as const,
      name: candidate.title,
      summary: candidate.need,
    })),
  };
};

/**
 * La línea que dice quién respondió.
 *
 * Vacía cuando la coordinación falló: firmar un fallo con nombres propios
 * sugiere que alguien revisó algo que no se llegó a revisar.
 */
export const buildTeamAttribution = (outcome: {
  status: string;
  team: readonly { role: string; personaId: keyof typeof OFFICE_AGENT_PERSONAS }[];
}): string => {
  if (outcome.status === 'failed') return '';
  const signers = outcome.team
    .filter((member) => member.role !== 'coordinator')
    .map((member) => OFFICE_AGENT_PERSONAS[member.personaId].alias);
  const partial = outcome.status === 'partial'
    ? ' · algún especialista no pudo entregar su análisis'
    : '';
  return `\n\n---\n_Respuesta del equipo de la Oficina: ${signers.join(', ')}${partial}._`;
};

export interface ConsultOfficeParams {
  request: string;
  project: Project;
  initiatives: readonly BusinessInitiative[];
  settings: Settings;
  /** Cómo se habla con el modelo. La pantalla lo aporta; esto no lo sabe. */
  chat: Parameters<typeof buildCoordinationInvoker>[0]['chat'];
}

/**
 * Pregunta a la Oficina y devuelve la respuesta ya firmada.
 *
 * Una sola llamada para la pantalla, que es el objetivo: el modal pasa de
 * conocer cuatro ficheros de la Oficina a conocer éste.
 */
export const consultOffice = async (params: ConsultOfficeParams): Promise<string> => {
  const scope = buildProjectScope(params.project, params.initiatives);
  const outcome = await coordinateRequest({
    request: params.request,
    scope,
    invoke: buildCoordinationInvoker({
      chat: params.chat,
      settings: params.settings,
      scope: {
        level: 'project',
        id: params.project.id,
        name: params.project.name,
        briefing: [`Descripción: ${params.project.description}`],
      },
      project: params.project,
    }),
  });
  return `${outcome.answer}${buildTeamAttribution(outcome)}`;
};

/* ── Cómo se nombra y se resume cada nivel ────────────────────────────────── */
/**
 * El nombre con el que la Oficina ve una iniciativa.
 *
 * `NEG-2026-001 · Alta digital` cuando hay código, el título a secas cuando no.
 * Esta regla estaba escrita **tres veces** —`InitiativeRoom`, `InitiativesPage`
 * y `ProjectHub`, este último para la ascendencia— en tres ficheros cuyo
 * trabajo es pintar. El código es lo que la gente cita en un comité; que
 * aparezca o no delante del título no puede depender de qué pantalla preguntó.
 */
export const initiativeDisplayName = (initiative: Pick<BusinessInitiative, 'code' | 'title'>): string =>
  (initiative.code ? `${initiative.code} · ${initiative.title}` : initiative.title);

/**
 * Lo esencial de una iniciativa: para enmarcar la pregunta desde una tarjeta.
 * El equipo puede pedir el resto.
 */
export const briefInitiative = (initiative: BusinessInitiative): string[] => [
  `Necesidad: ${initiative.need}`,
  ...(initiative.driver ? [`Driver: ${initiative.driver}`] : []),
  ...(initiative.objectives.length > 0 ? [`Objetivos: ${initiative.objectives.join('; ')}`] : []),
];

/**
 * La iniciativa entera: lo que se cuenta desde su sala, donde el usuario espera
 * que el equipo ya sepa de qué va sin tener que repetírselo.
 */
export const briefInitiativeInDepth = (
  initiative: BusinessInitiative,
  attentions: readonly { name: string }[],
): string[] => {
  const briefing: string[] = [];
  if (initiative.need) briefing.push(`Necesidad: ${initiative.need}`);
  if (initiative.driver) briefing.push(`Driver: ${initiative.driver}`);
  if (initiative.objectives.length > 0) briefing.push(`Objetivos: ${initiative.objectives.join('; ')}`);
  if (initiative.expectedOutcomes.length > 0) {
    briefing.push(`Resultados esperados: ${initiative.expectedOutcomes.map((outcome) => outcome.statement).join('; ')}`);
  }
  if (initiative.kpis.length > 0) briefing.push(`Indicadores: ${initiative.kpis.map((kpi) => kpi.name).join('; ')}`);
  if (initiative.risks.length > 0) briefing.push(`Riesgos: ${initiative.risks.map((risk) => risk.description).join('; ')}`);
  if (attentions.length > 0) {
    briefing.push(`Proyectos de arquitectura que ya la atienden: ${attentions.map((project) => project.name).join('; ')}`);
  }
  return briefing;
};

/** El ámbito de una iniciativa, con el briefing que la pantalla decida. */
export const buildInitiativeScope = (
  initiative: BusinessInitiative,
  briefing: string[],
): CoordinationScope => ({
  level: 'initiative',
  id: initiative.id,
  name: initiativeDisplayName(initiative),
  briefing,
});

/**
 * Lo que se cuenta de un proyecto desde su hub: descripción, contexto y qué
 * artefactos existen ya.
 *
 * **Ojo con la divergencia que esto deja a la vista.** `buildProjectScope` —el
 * que usa el copiloto— no incluye los artefactos ni antepone el código a las
 * iniciativas de la ascendencia. Son dos respuestas distintas a «cuéntale a la
 * Oficina de este proyecto», y la diferencia no parece una decisión: parece que
 * se escribieron en momentos distintos.
 *
 * No se unifican aquí porque cambiar lo que viaja en un prompt cambia lo que
 * responde el modelo, y eso es un cambio de comportamiento que merece su propio
 * commit y su propia comprobación. Queda escrito para que quien lo decida lo
 * vea.
 */
export const briefProjectInDepth = (project: Project): string[] => {
  const briefing = [`Descripción: ${project.description}`];
  if (project.projectContext.length > 0) {
    briefing.push(`Contexto del proyecto: ${project.projectContext.join('; ')}`);
  }
  if (project.artifacts.length > 0) {
    briefing.push(`Artefactos existentes: ${[...new Set(project.artifacts.map((artifact) => artifact.name))].join('; ')}`);
  }
  return briefing;
};

/** El ámbito de un proyecto desde su hub, con su ascendencia nombrada por código. */
export const buildProjectHubScope = (
  project: Project,
  initiatives: readonly BusinessInitiative[],
): CoordinationScope => {
  const linked = initiatives.filter((candidate) => (project.initiativeIds ?? []).includes(candidate.id));
  return {
    level: 'project',
    id: project.id,
    name: project.name,
    briefing: briefProjectInDepth(project),
    ancestry: linked.map((candidate) => ({
      level: 'initiative' as const,
      name: initiativeDisplayName(candidate),
      summary: candidate.need,
    })),
  };
};

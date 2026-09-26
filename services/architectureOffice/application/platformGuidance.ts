/**
 * Qué sabe la guía de la plataforma cuando alguien le pregunta cómo funciona.
 *
 * Es la mitad de dominio del asistente de uso: compone **qué** se le cuenta al
 * modelo —la identidad del producto, sus cuatro niveles y el reparto real de
 * agentes— y deja el **cómo** se le habla a `services/ai/generation/platformGuide`.
 * La misma separación que la captura asistida, por la misma razón: el dominio
 * compone la instrucción, la infraestructura la ejecuta y la pantalla no
 * conoce ninguna de las dos.
 *
 * La decisión que justifica que este fichero exista, en vez de escribir el
 * reparto a mano en el catálogo de `lib/platformGuide`: **el número de agentes
 * y lo que hace cada uno se leen del registro**. Una guía que dijera «hay trece
 * agentes» en un texto fijo mentiría el día que se añada el catorceavo, y lo
 * haría precisamente al usuario que ha entrado a preguntar cuántos hay.
 *
 * Vive en `application/` y no en el raíz del módulo porque es composición para
 * una pantalla, como `assistantConsultation` y `captureAssistance`.
 */

import {
  buildAgentProfileBriefing,
  resolveAgentProfiles,
  type OfficeAgentProfile,
  type OfficeAgentProfileOverride,
} from '../domain/officeAgentProfile';
import { EA_LEVELS, PRODUCT_NAME } from '../../../lib/eaTerminology';
import {
  findGuideTopics,
  PLATFORM_GUIDE_TOPICS,
  type PlatformGuideRequest,
  type PlatformGuideTopic,
  type PlatformGuideTurn,
} from '../../../lib/platformGuide';

/** Cuántas vueltas de conversación viajan. Más no mejora y encarece cada llamada. */
export const PLATFORM_GUIDE_HISTORY_TURNS = 6;

const ORCHESTRATION_TEXT: Readonly<Record<OfficeAgentProfile['orchestrationRole'], string>> = Object.freeze({
  generalist: 'generalista, atiende preguntas de un solo dominio',
  coordinator: 'coordina el equipo y reparte el trabajo',
  consolidator: 'consolida los análisis y firma la recomendación',
  participant: 'especialista de su dominio',
});

/**
 * El reparto, tal y como lo tenga configurado quien pregunta.
 *
 * Con los overrides aplicados a propósito: si alguien ha renombrado a Sofía o
 * la ha desactivado, la ayuda tiene que hablar de la Oficina que esa persona
 * ve, no de la de fábrica.
 */
export const describeAgentRoster = (
  overrides: readonly OfficeAgentProfileOverride[] = [],
): string[] => {
  const profiles = resolveAgentProfiles(overrides);
  const available = profiles.filter((profile) => profile.enabled);
  const lines = [
    `La Oficina tiene ${profiles.length} agentes${available.length !== profiles.length
      ? `, de los cuales ${available.length} están disponibles ahora mismo (el resto los ha desactivado el usuario en su ficha)`
      : ''}:`,
  ];
  for (const profile of profiles) {
    lines.push(
      `- ${profile.alias} — ${profile.role}. ${ORCHESTRATION_TEXT[profile.orchestrationRole]}.`
      + ` Dominios: ${profile.domains.join(', ')}.`
      + ` Produce ${profile.producesArtifactTypes.length} tipo(s) de artefacto y revisa ${profile.reviewsArtifactTypes.length}.`
      + (profile.enabled ? '' : ' Está desactivado.'),
    );
  }
  return lines;
};

/**
 * Lo que la guía sabe del producto, en las líneas que viajan en el prompt.
 *
 * Los nombres de los niveles salen de `lib/eaTerminology`, que es la única
 * fuente de esos nombres en todo el producto. Escribirlos aquí otra vez sería
 * la segunda, y sería la que le enseña el vocabulario al usuario.
 */
export const buildPlatformGuideBriefing = (
  overrides: readonly OfficeAgentProfileOverride[] = [],
): string[] => [
  `Eres la guía de uso de ${PRODUCT_NAME}, una plataforma de arquitectura empresarial.`,
  'Tu único trabajo es explicar cómo funciona la plataforma y cómo se usa.',
  '',
  'LOS CUATRO NIVELES, de fuera hacia dentro:',
  `- ${EA_LEVELS.initiative.singular}: ${EA_LEVELS.initiative.plural.toLowerCase()} son la necesidad del negocio.`,
  `- ${EA_LEVELS.engagementProject.singular}: la respuesta de arquitectura a esa necesidad.`,
  `- ${EA_LEVELS.deliverable.singular}: una unidad de trabajo gobernada por la Oficina.`,
  `- ${EA_LEVELS.artifact.singular}: cada documento o diagrama que se produce.`,
  'Cada nivel se crea desde el de arriba y arrastra su contexto.',
  '',
  ...describeAgentRoster(overrides),
];

/**
 * La petición completa: la pregunta, el briefing y los temas más cercanos.
 *
 * Los temas se eligen aquí, con la búsqueda léxica de `lib/platformGuide`, y no
 * se le manda el catálogo entero: un prompt con dieciocho temas para responder
 * a «¿qué es una iniciativa?» es caro y, peor, diluye el tema que importaba.
 */
export const buildPlatformGuideRequest = (
  question: string,
  options: {
    overrides?: readonly OfficeAgentProfileOverride[];
    history?: readonly PlatformGuideTurn[];
    topics?: readonly PlatformGuideTopic[];
  } = {},
): PlatformGuideRequest => {
  const catalogue = options.topics ?? PLATFORM_GUIDE_TOPICS;
  const matched = findGuideTopics(question, catalogue);
  return {
    question: question.trim(),
    briefing: buildPlatformGuideBriefing(options.overrides),
    // Sin coincidencias se mandan los temas de orientación: alguien que
    // pregunta algo que no está en el catálogo casi siempre está perdido en la
    // jerarquía, y eso sí se puede contestar.
    topics: matched.length > 0
      ? matched
      : catalogue.filter((entry) => entry.id === 'niveles' || entry.id === 'agentes'),
    history: (options.history ?? []).slice(-PLATFORM_GUIDE_HISTORY_TURNS),
  };
};

/**
 * El briefing del agente que firma la respuesta.
 *
 * Es Arky, el generalista, por la misma razón que asiste la captura: «¿cómo
 * pido un entregable?» es una pregunta de un solo dominio con un criterio de
 * aceptación único. Convocar a la coordinadora, cuatro especialistas y el
 * consolidador para contestarla costaría varias llamadas y varios segundos, y
 * la respuesta sería la misma.
 */
export const platformGuideAgentBriefing = (
  overrides: readonly OfficeAgentProfileOverride[] = [],
): string[] => {
  const profile = resolveAgentProfiles(overrides).find((entry) => entry.agentId === 'arky');
  return profile ? buildAgentProfileBriefing(profile) : [];
};

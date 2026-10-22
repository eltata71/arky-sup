/**
 * Ensayar un agente desde su ficha, antes de guardarlo (plan de agentes 16.6).
 *
 * El editor permite cambiar la instrucción y restaurar valores de fábrica, pero
 * hasta ahora no había forma de ver el *prompt efectivo* ni de preguntarle algo
 * al borrador: el error de una ficha se descubría en un entregable real (A26).
 * Este módulo es la única puerta del ensayo, y vive en `application/` porque
 * es coordinación, no pintura: el editor le pasa lo que el usuario escribió y
 * recibe texto, preguntas de ejemplo y una respuesta medida — sin guardar nada.
 *
 * Dos reglas que este fichero protege:
 *
 * - **El texto mostrado es exactamente el que se enviaría.** Tanto la vista
 *   previa como el ensayo componen con la misma función que una conversación
 *   real (`composeProjectChatInstruction`); no hay un segundo compositor que
 *   pudiera divergir. Lo que se lee es lo que el agente recibiría.
 * - **El ensayo no escribe.** Viaja en un carrier efímero, no toca repositorio
 *   ni bitácora, y hace una sola llamada. Es una prueba, no una operación.
 *
 * La capa de IA no entra por importación estática: `projectConversation` —que
 * llega a `services/ai/lazy`— se carga con `import()` dentro de las
 * dependencias por defecto, de modo que abrir la ficha no descarga el motor:
 * el primer «Ensayar» sí.
 *
 * No está detrás de la puerta `agents.ts` (F6-05): ese módulo no llama a
 * modelos. Quien lo importe es la ficha, directamente.
 */

import type { Settings } from '../../../types';
import type { Project } from '../../architectureProjects';
import type { ModelTier } from '../../../lib/ai/modelCatalog';
import type { AgentInvocationResult } from '../../../lib/ai/agentUsage';
import { estimateAgentCostUsd } from '../../../lib/ai/agentUsage';
import type { OfficeAgentId } from '../domain/agentDefinition';
import type { OfficeAgentProfile, OfficeAgentProfileOverride } from '../domain/officeAgentProfile';
import { resolveAgentProfile } from '../domain/officeAgentProfile';
import { composeAgentInstruction, AGENT_PROMPT_LAYERS } from '../domain/agentPromptComposer';

/** El borrador que trae la ficha: lo que el usuario escribió, aún sin guardar. */
export interface DraftAgentProfileState {
  agentId: OfficeAgentId;
  alias?: string;
  role?: string;
  avatar?: string;
  skills?: string[];
  knowledge?: string[];
  memory?: string[];
  instruction?: string;
  modelTier?: ModelTier;
  maxConcurrentTasks?: number;
  enabled?: boolean;
}

/** Una capa del prompt efectivo, marcada para que la ficha la pueda destacar. */
export interface EffectiveInstructionLayer {
  id: 'contexto' | 'contrato' | 'organizacion' | 'reglas';
  /** El encabezado tal como aparece en el texto enviado. */
  header: string | null;
  /** El texto exacto de esta capa, tal como viaja en el prompt. */
  text: string;
}

/** Lo que «Ver instrucción efectiva» muestra. */
export interface EffectiveInstructionPreview {
  /** El texto completo, exactamente el que se enviaría como instrucción de sistema. */
  instruction: string;
  /** Sólo la voz del agente (las capas del compositor), sin el contexto del proyecto. */
  voice: string;
  layers: EffectiveInstructionLayer[];
}

/** Una pregunta de ejemplo para ensayar el agente. */
export interface RehearsalSampleQuestion {
  kind: 'in-scope' | 'work' | 'out-of-scope';
  text: string;
}

/** Entrada de un ensayo: la pregunta de prueba y las piezas que la API necesita. */
export interface RehearseInput {
  question: string;
  draft: DraftAgentProfileState;
  settings: Settings;
}

/** Lo que el ensayo devuelve: la respuesta y lo que costó producirla. */
export interface RehearsalResult {
  answer: string;
  model: string | null;
  tier: ModelTier;
  latencyMs: number;
  estimatedCostUsd: number | null;
}

/**
 * Cómo el borrador llega a la función que compone y a la que llama.
 *
 * Inyectados para que las pruebas ensayen el servicio sin tocar la capa de IA;
 * el valor por defecto es el de producción, que carga por `services/ai/lazy`.
 */
export interface DraftAgentRehearsalDeps {
  composeInstruction: (
    carrier: Project,
    question: string,
    settings: Settings,
    personaOverride: OfficeAgentId,
    profile: OfficeAgentProfile,
  ) => Promise<string>;
  chat: (
    carrier: Project,
    question: string,
    settings: Settings,
    personaOverride: OfficeAgentId,
    modelTier: ModelTier,
    profile: OfficeAgentProfile,
  ) => Promise<AgentInvocationResult>;
  /** Fábrica del sello temporal de los overrides efímeros; fija en pruebas. */
  now?: () => string;
}

/** El carrier del ensayo: un sobre de prompt, nunca un proyecto almacenado. */
export const DRAFT_REHEARSAL_CARRIER_PREFIX = 'draft-rehearsal:';

export const draftRehearsalCarrier = (agentId: OfficeAgentId): Project => ({
  id: `${DRAFT_REHEARSAL_CARRIER_PREFIX}${agentId}`,
  name: 'Ensayo de la ficha del agente',
  description: 'Pregunta de prueba contra un borrador sin guardar (16.6).',
  projectContext: [],
  artifacts: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

/**
 * Un override que existe sólo en memoria, para resolver el borrador con la
 * misma función que resuelve las fichas guardadas. Nunca se persiste: su
 * `userId` lo dice («ensayo»), y su dueño es la pantalla que lo creó.
 */
export const draftOverride = (
  draft: DraftAgentProfileState,
  now: () => string = () => new Date().toISOString(),
): OfficeAgentProfileOverride => ({
  agentId: draft.agentId,
  userId: 'draft-rehearsal',
  schemaVersion: 1,
  alias: draft.alias,
  role: draft.role,
  avatar: draft.avatar,
  skills: draft.skills,
  knowledge: draft.knowledge,
  memory: draft.memory,
  instruction: draft.instruction,
  modelTier: draft.modelTier,
  maxConcurrentTasks: draft.maxConcurrentTasks,
  enabled: draft.enabled,
  updatedAt: now(),
});

/** Marca las capas del prompt efectivo, partido por sus encabezados conocidos. */
export const markInstructionLayers = (instruction: string): EffectiveInstructionLayer[] => {
  const headers: readonly { id: EffectiveInstructionLayer['id']; header: string }[] = [
    { id: 'contrato', header: AGENT_PROMPT_LAYERS.contract },
    { id: 'organizacion', header: AGENT_PROMPT_LAYERS.organization },
    { id: 'reglas', header: AGENT_PROMPT_LAYERS.rules },
  ];
  const found = headers
    .map(({ id, header }) => ({ id, header, index: instruction.indexOf(header) }))
    .filter(({ index }) => index >= 0)
    .sort((a, b) => a.index - b.index);
  if (found.length === 0) {
    return [{ id: 'contexto', header: null, text: instruction.trim() }];
  }
  // Cada capa empieza en su encabezado; si hay una línea vacía delante, la
  // captura, para que unir las capas con «\n» reconstruya el texto exacto.
  const starts = found.map(({ index }) =>
    index > 0 && instruction[index - 2] === '\n' ? index - 1 : index);
  const layers: EffectiveInstructionLayer[] = [];
  if (starts[0] > 0) {
    layers.push({
      id: 'contexto',
      header: null,
      text: instruction.slice(0, starts[0] - 1).trim(),
    });
  }
  for (let i = 0; i < found.length; i += 1) {
    const end = i < found.length - 1 ? starts[i + 1] - 1 : instruction.length;
    layers.push({ id: found[i].id, header: found[i].header, text: instruction.slice(starts[i], end) });
  }
  return layers;
};

/**
 * Las preguntas de ejemplo por rol: dos dentro del alcance, una fuera de
 * él (para comprobar que los `nonGoals` llegan al agente y este la declina).
 * Se derivan del contrato de fábrica; la ficha no las toca.
 */
export const sampleQuestionsFor = (agentId: OfficeAgentId): RehearsalSampleQuestion[] => {
  const profile = resolveAgentProfile(agentId);
  const goals = profile.scope.goals;
  const nonGoals = profile.scope.nonGoals;
  const questions: RehearsalSampleQuestion[] = [];
  if (goals.length > 0) {
    questions.push({ kind: 'in-scope', text: `¿Cómo abordarías este encargo: ${goals[0]}?` });
  }
  if (profile.producesArtifactTypes.length > 0) {
    questions.push({
      kind: 'work',
      text: `Prepara un borrador de ${profile.producesArtifactTypes[0]} para revisión.`,
    });
  } else if (profile.domains.length > 0) {
    // Un rol que no produce entregables (el coordinador) también necesita su
    // pregunta de trabajo: se ancla en su dominio, no en un artefacto.
    questions.push({
      kind: 'work',
      text: `¿Cómo encaja tu trabajo en ${profile.domains[0]}?`,
    });
  }
  if (nonGoals.length > 0) {
    questions.push({ kind: 'out-of-scope', text: `¿Puedes ayudarme con esto: ${nonGoals[0]}?` });
  }
  return questions;
};

export const createDraftAgentRehearsal = (
  deps: DraftAgentRehearsalDeps = {
    // La capa de IA llega en el primer uso, no al importar este módulo: la
    // ficha de un agente no debe pagar por el motor hasta que alguien ensaya.
    composeInstruction: (carrier, question, settings, personaOverride, profile) =>
      import('./projectConversation').then(({ composeProjectChatInstruction }) =>
        composeProjectChatInstruction(carrier, question, settings, personaOverride, profile)),
    chat: (carrier, question, settings, personaOverride, modelTier, profile) =>
      import('./projectConversation').then(({ chatWithProjectMeasured }) =>
        chatWithProjectMeasured(carrier, question, [], settings, personaOverride, modelTier, profile)),
  },
) => ({
  /**
   * La instrucción efectiva del borrador: el mismo texto que una conversación
   * real le enviaría al agente, partido en capas para poder marcarlas.
   */
  previewInstruction: async (
    draft: DraftAgentProfileState,
    settings: Settings,
  ): Promise<EffectiveInstructionPreview> => {
    const override = draftOverride(draft, deps.now);
    const resolved = resolveAgentProfile(draft.agentId, override);
    const carrier = draftRehearsalCarrier(draft.agentId);
    const instruction = await deps.composeInstruction(carrier, '', settings, draft.agentId, resolved);
    return {
      instruction,
      voice: composeAgentInstruction('', resolved).trim(),
      layers: markInstructionLayers(instruction),
    };
  },

  sampleQuestions: (agentId: OfficeAgentId): RehearsalSampleQuestion[] =>
    sampleQuestionsFor(agentId),

  /**
   * El ensayo: una pregunta de prueba contra el borrador, sin guardar nada.
   * Una sola llamada; la respuesta llega medida (tier, modelo, coste estimado).
   */
  rehearse: async (input: RehearseInput): Promise<RehearsalResult> => {
    const override = draftOverride(input.draft, deps.now);
    const carrier = draftRehearsalCarrier(input.draft.agentId);
    const tier = input.draft.modelTier ?? 'default';
    const result = await deps.chat(
      carrier,
      input.question,
      input.settings,
      input.draft.agentId,
      tier,
      resolveAgentProfile(input.draft.agentId, override),
    );
    return {
      answer: result.text,
      model: result.model,
      tier,
      latencyMs: result.latencyMs,
      estimatedCostUsd: estimateAgentCostUsd(result.model, result.usage),
    };
  },
});

/** El servicio de ensayo, tal como la ficha lo consume. */
export type DraftAgentRehearsalService = ReturnType<typeof createDraftAgentRehearsal>;

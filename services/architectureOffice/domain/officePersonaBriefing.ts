/**
 * La voz de una persona de la Oficina cuando entra en un prompt.
 *
 * Todo pasa por `composeAgentInstruction` (`agentPromptComposer`), que lee la
 * **ficha resuelta**: sin ficha guardada es la persona de fábrica, con ficha es
 * la persona más lo que la organización añadió. Antes había dos compositores y
 * el de fábrica era el único que llegaba al prompt de sistema (plan de agentes,
 * 16.0). Quien tiene la ficha del usuario la pasa; quien no, obtiene la de
 * fábrica — nunca una mezcla de las dos.
 */
// The port's own leaf, not the agent barrel: naming a type through a barrel
// drags the whole agent — and the AI layer behind it — into type checking.
import type { AgentPersonaBriefing } from '../../agent/agentPersonaBriefing';
import type { ArtifactPersonaComposer } from '../../../lib/artifacts';
import { composeAgentInstruction } from './agentPromptComposer';
import { getOfficeArchitectureContext } from './officeArchitectureKnowledge';
import { resolveAgentProfile, type OfficeAgentProfile } from './officeAgentProfile';
import {
  resolveOfficeAgentMention,
  type OfficeAgentId,
  type OfficeAgentPersona,
} from './officeAgentPersonas';

/** La ficha que habla: la que se pasó si es de este agente, si no la de fábrica. */
const profileFor = (agentId: OfficeAgentId, profile?: OfficeAgentProfile): OfficeAgentProfile =>
  profile && profile.agentId === agentId ? profile : resolveAgentProfile(agentId);

/** Las fichas resueltas de un usuario, tal como las entrega `useAgentProfiles`. */
export type AgentProfileSet = readonly OfficeAgentProfile[];

const findProfile = (profiles: AgentProfileSet | undefined, agentId: OfficeAgentId): OfficeAgentProfile | undefined =>
  profiles?.find((profile) => profile.agentId === agentId);

/**
 * Quién habla cuando un texto nombra a un agente, con las fichas del usuario.
 *
 * Si el nombrado está desactivado en su ficha, responde Arky —que nunca se
 * desactiva para esto: alguien tiene que contestar— y el prompt lo dice, para
 * que la respuesta no finja ser de quien el usuario apagó (plan de agentes,
 * 16.1 · A4).
 */
export const resolveMentionedSpeaker = (
  message: string,
  profiles?: AgentProfileSet,
): { profile: OfficeAgentProfile; disabledMention?: OfficeAgentProfile } => {
  const mentioned = resolveOfficeAgentMention(message);
  const profile = profileFor(mentioned.id, findProfile(profiles, mentioned.id));
  if (profile.enabled || profile.agentId === 'arky') return { profile };
  return { profile: profileFor('arky', findProfile(profiles, 'arky')), disabledMention: profile };
};

const disabledNote = (disabled: OfficeAgentProfile): string =>
  `${disabled.alias} está desactivado en la ficha del usuario: respondes tú en su lugar. Dilo al empezar y no hables en su nombre.`;

/**
 * El prompt de sistema de una persona sobre la instrucción base de quien llama.
 * `profile` es la ficha resuelta del usuario, cuando la hay.
 */
export const buildOfficePersonaInstruction = (
  baseInstruction: string,
  selected: OfficeAgentPersona,
  profile?: OfficeAgentProfile,
): string => composeAgentInstruction(baseInstruction, profileFor(selected.id, profile));

/**
 * The persona composer artifact generation asks for (F5-01, corte 13): the
 * persona the request names — Arky when it names none — composed over the
 * base instruction. The AI layer declares the port
 * (`ArtifactPersonaComposer`, `lib/artifacts`) because it cannot import the
 * Office that imports it; this is the Office's side of it.
 */
export const composeArtifactPersonaInstruction = (
  baseInstruction: string,
  request: string,
  profiles?: AgentProfileSet,
): string => {
  const { profile, disabledMention } = resolveMentionedSpeaker(request, profiles);
  const composed = composeAgentInstruction(baseInstruction, profile);
  return disabledMention ? `${composed}\n${disabledNote(disabledMention)}` : composed;
};

/** El compositor que la generación de artefactos pide, con las fichas del usuario. */
export const artifactPersonaComposerFor = (profiles?: AgentProfileSet): ArtifactPersonaComposer =>
  (baseInstruction, request) => composeArtifactPersonaInstruction(baseInstruction, request, profiles);

/**
 * Adapt an Office persona into the briefing the agent asks for.
 *
 * This is the adapter half of the port declared in
 * `services/agent/agentContextComposer.ts`. It lives here because the office is
 * the side that knows both vocabularies — the agent must not learn that an
 * Architecture Office exists, or the two modules import each other again.
 */
export const buildOfficePersonaBriefing = (
  personaId: OfficeAgentId,
  profile?: OfficeAgentProfile,
): AgentPersonaBriefing => {
  const speaker = profileFor(personaId, profile);
  const architecture = getOfficeArchitectureContext();
  return {
    composeInstruction: (baseInstruction: string) => composeAgentInstruction(baseInstruction, speaker),
    sections: [
      [
        `Estándares de la Oficina de Arquitectura (v${architecture.version}):`,
        ...architecture.promptContext.map((item) => `- ${item}`),
      ].join('\n'),
    ],
  };
};

/**
 * The briefing for whoever a message names — `@Alias` — or Arky when it names
 * nobody. What the engine did inside every agent turn before F5-01 (corte 8);
 * now the side that knows the Office hands it to the agent. Sólo para el chat,
 * donde quien escribe elige a quién habla: un encargo fija la persona por la
 * tarea (16.2).
 */
export const officePersonaForMessage = (message: string, profiles?: AgentProfileSet): AgentPersonaBriefing => {
  const { profile, disabledMention } = resolveMentionedSpeaker(message, profiles);
  const briefing = buildOfficePersonaBriefing(profile.agentId, profile);
  return disabledMention
    ? { ...briefing, sections: [...briefing.sections, disabledNote(disabledMention)] }
    : briefing;
};

/** `officePersonaForMessage` con las fichas del usuario ya fijadas, para pasarlo como puerto. */
export const officePersonaResolverFor = (profiles?: AgentProfileSet) =>
  (message: string): AgentPersonaBriefing => officePersonaForMessage(message, profiles);

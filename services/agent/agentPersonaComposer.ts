/**
 * The agent's persona, as the composer artifact generation asks for (F5-01,
 * corte 13): resolved from the request, composed over the base instruction.
 * No resolver, no composer — generation then sends the base instruction.
 *
 * And the options the agent hands to every generation (corte 14): the persona
 * plus the artifacts context's `support` — the controlled source selection and
 * the deterministic fallbacks the AI layer declares and cannot look up.
 */
import type { ArtifactBusinessMotivation, ArtifactPersonaComposer } from '../../lib/artifacts';
import type { ArtifactContentGenerationOptions } from '../ai';
import { artifactGenerationSupport } from '../artifacts';
import { extractConversationDecisions, type ChatMessage } from '../chat';
import type { AgentPersonaBriefing } from './agentContextComposer';

export const personaComposer = (
  resolvePersona?: (message: string) => AgentPersonaBriefing,
): ArtifactPersonaComposer | undefined =>
  resolvePersona ? (baseInstruction, request) => resolvePersona(request).composeInstruction(baseInstruction) : undefined;

export const agentGenerationOptions = (
  resolvePersona?: (message: string) => AgentPersonaBriefing,
  businessMotivation?: readonly ArtifactBusinessMotivation[],
  /** The conversation the action came from: its decisions reach the generation (7.3b). */
  history?: readonly ChatMessage[],
): ArtifactContentGenerationOptions => {
  const conversation = extractConversationDecisions(history);
  return {
    composePersonaInstruction: personaComposer(resolvePersona),
    support: artifactGenerationSupport,
    ...(businessMotivation?.length ? { businessMotivation } : {}),
    ...(conversation.decisions.length ? { conversation } : {}),
  };
};

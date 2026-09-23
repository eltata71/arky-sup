/**
 * The agent's persona, as the composer artifact generation asks for (F5-01,
 * corte 13): resolved from the request, composed over the base instruction.
 * No resolver, no composer — generation then sends the base instruction.
 */
import type { ArtifactPersonaComposer } from '../../lib/artifacts';
import type { AgentPersonaBriefing } from './agentContextComposer';

export const personaComposer = (
  resolvePersona?: (message: string) => AgentPersonaBriefing,
): ArtifactPersonaComposer | undefined =>
  resolvePersona ? (baseInstruction, request) => resolvePersona(request).composeInstruction(baseInstruction) : undefined;

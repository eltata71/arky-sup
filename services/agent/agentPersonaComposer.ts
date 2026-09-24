/**
 * The agent's persona, as the composer artifact generation asks for (F5-01,
 * corte 13): resolved from the request, composed over the base instruction.
 * No resolver, no composer — generation then sends the base instruction.
 *
 * And the options the agent hands to every generation (corte 14): the persona
 * plus the artifacts context's `support` — the controlled source selection and
 * the deterministic fallbacks the AI layer declares and cannot look up.
 */
import type { ArtifactPersonaComposer } from '../../lib/artifacts';
import type { ArtifactContentGenerationOptions } from '../ai';
import { artifactGenerationSupport } from '../artifacts';
import type { AgentPersonaBriefing } from './agentContextComposer';

export const personaComposer = (
  resolvePersona?: (message: string) => AgentPersonaBriefing,
): ArtifactPersonaComposer | undefined =>
  resolvePersona ? (baseInstruction, request) => resolvePersona(request).composeInstruction(baseInstruction) : undefined;

export const agentGenerationOptions = (
  resolvePersona?: (message: string) => AgentPersonaBriefing,
): ArtifactContentGenerationOptions => ({
  composePersonaInstruction: personaComposer(resolvePersona),
  support: artifactGenerationSupport,
});

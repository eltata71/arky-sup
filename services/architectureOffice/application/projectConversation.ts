/**
 * The project chat, answered by a member of the Office (F5-01, corte 8).
 *
 * The engine used to do this whole turn, persona included, which meant the AI
 * layer reached up into the Office to learn who was speaking. The split now
 * follows the dependency: `services/ai` says what the project is
 * (`buildProjectChatInstruction`) and asks the model; this file decides who
 * answers and under which standards, which is Office policy.
 *
 * `personaOverride` binds the speaker explicitly. The runner passes it so a
 * coordination brief that happens to contain an `@Alias` never hijacks the
 * persona of a downstream workstream; without it, the message's own mention
 * decides, and Arky answers when nobody is named.
 */
import type { Settings } from '../../../types';
import type { ModelTier } from '../../../lib/ai/modelCatalog';
import type { Project } from '../../architectureProjects';
import { assistantService, buildProjectChatInstruction } from '../../ai/lazy';
import type { ProjectChatTurn } from '../../ai';
import {
  OFFICE_AGENT_PERSONAS,
  resolveOfficeAgentMention,
  type OfficeAgentId,
} from '../domain/officeAgentPersonas';
import { buildOfficePersonaInstruction } from '../domain/officePersonaBriefing';
import type { OfficeAgentProfile } from '../domain/officeAgentProfile';
import { getOfficeArchitectureContext } from '../domain/officeArchitectureKnowledge';
import type { AgentInvocationResult } from '../../../lib/ai/agentUsage';
import type { OfficeAgentCallOptions } from './officeOrchestrationTypes';

/** The project instruction, framed by the persona and the Office's standards. */
export async function composeProjectChatInstruction(
  project: Project,
  message: string,
  settings: Settings,
  personaOverride?: OfficeAgentId,
  /** La ficha resuelta del agente que habla, cuando quien llama la tiene. */
  profile?: OfficeAgentProfile,
): Promise<string> {
  const standards = getOfficeArchitectureContext().promptContext.map((item) => `- ${item}`).join('\n');
  return buildOfficePersonaInstruction(
    `${await buildProjectChatInstruction(project, settings)}\n\nARCHITECTURE OFFICE STANDARDS:\n${standards}`,
    personaOverride ? OFFICE_AGENT_PERSONAS[personaOverride] : resolveOfficeAgentMention(message),
    profile,
  );
}

export async function chatWithProject(
  project: Project,
  message: string,
  history: readonly ProjectChatTurn[],
  settings: Settings,
  personaOverride?: OfficeAgentId,
  /** Tier for this turn — the runner resolves it from the agent's card. */
  modelTier: ModelTier = 'default',
  /**
   * La ficha resuelta del agente que habla. Sin ella habla la persona de
   * fábrica; con ella, la persona más lo que la organización añadió — en el
   * prompt de sistema, no antepuesta al mensaje (plan de agentes, 16.0).
   */
  profile?: OfficeAgentProfile,
): Promise<string> {
  return assistantService.generateProjectChatReply({
    systemInstruction: await composeProjectChatInstruction(project, message, settings, personaOverride, profile),
    message,
    history,
    settings,
    modelTier,
  });
}

/** Coordinated calls retain provider usage; ordinary chat keeps its text API. */
export async function chatWithProjectMeasured(
  project: Project,
  message: string,
  history: readonly ProjectChatTurn[],
  settings: Settings,
  personaOverride?: OfficeAgentId,
  modelTier: ModelTier = 'default',
  profile?: OfficeAgentProfile,
  callOptions?: OfficeAgentCallOptions,
): Promise<AgentInvocationResult> {
  return assistantService.generateProjectChatReplyMeasured({
    systemInstruction: await composeProjectChatInstruction(project, message, settings, personaOverride, profile),
    message,
    history,
    settings,
    modelTier,
    signal: callOptions?.signal,
    timeoutMs: callOptions?.timeoutMs,
    responseSchema: callOptions?.responseSchema,
    operationId: callOptions?.operationId,
    invocationId: callOptions?.invocationId,
    temperature: callOptions?.temperature,
  });
}

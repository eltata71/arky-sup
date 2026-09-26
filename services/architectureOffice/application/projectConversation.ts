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
import { assistantService, type ProjectChatTurn } from '../../ai';
import {
  buildOfficePersonaInstruction,
  OFFICE_AGENT_PERSONAS,
  resolveOfficeAgentMention,
  type OfficeAgentId,
} from '../domain/officeAgentPersonas';
import { getOfficeArchitectureContext } from '../domain/officeArchitectureKnowledge';

/** The project instruction, framed by the persona and the Office's standards. */
export function composeProjectChatInstruction(
  project: Project,
  message: string,
  settings: Settings,
  personaOverride?: OfficeAgentId,
): string {
  const standards = getOfficeArchitectureContext().promptContext.map((item) => `- ${item}`).join('\n');
  return buildOfficePersonaInstruction(
    `${assistantService.buildProjectChatInstruction(project, settings)}\n\nARCHITECTURE OFFICE STANDARDS:\n${standards}`,
    personaOverride ? OFFICE_AGENT_PERSONAS[personaOverride] : resolveOfficeAgentMention(message),
  );
}

export function chatWithProject(
  project: Project,
  message: string,
  history: readonly ProjectChatTurn[],
  settings: Settings,
  personaOverride?: OfficeAgentId,
  /** Tier for this turn — the runner resolves it from the agent's card. */
  modelTier: ModelTier = 'default',
): Promise<string> {
  return assistantService.generateProjectChatReply({
    systemInstruction: composeProjectChatInstruction(project, message, settings, personaOverride),
    message,
    history,
    settings,
    modelTier,
  });
}

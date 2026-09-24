/**
 * The project copilot's turns (F5-02): where a message goes, and the two ways
 * the Office answers one without executing anything.
 *
 * The routing is `routeCopilotTurn` in the Office's application layer; this
 * hook only hands it to the modal together with the failure description the
 * assistant panel uses, so `ProjectCopilotChatModal` stops reaching the agent,
 * the Office and the AI layer to decide what a message means.
 */
import type { Settings } from '../types';
import type { Artifact } from '../lib/artifacts';
import type { Project } from '../services/architectureProjects';
import type { BusinessInitiative } from '../services/businessInitiatives';
import type { ChatMessage } from '../services/chat';
import {
  consultCopilot,
  copilotAnchorFor,
  routeCopilotTurn,
  runCopilotOrchestration,
  type CopilotTurnRoute,
} from '../services/architectureOffice';
import { describeTurnFailure, type TurnFailure } from './useAssistantTurns';

export interface CopilotTurns {
  route(text: string, project: Project, history: ChatMessage[]): CopilotTurnRoute;
  orchestrate(text: string, project: Project, settings: Settings): Promise<string>;
  consult(question: string, project: Project, initiatives: readonly BusinessInitiative[], settings: Settings): Promise<string>;
  anchorFor(project: Project): Artifact;
  describeFailure(error: unknown): TurnFailure;
}

const TURNS: CopilotTurns = {
  route: routeCopilotTurn,
  orchestrate: runCopilotOrchestration,
  consult: consultCopilot,
  anchorFor: copilotAnchorFor,
  describeFailure: describeTurnFailure,
};

export const useCopilotTurns = (): CopilotTurns => TURNS;

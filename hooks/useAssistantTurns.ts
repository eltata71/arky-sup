/**
 * The assistant turns a screen sends, with the Office deciding who answers
 * (F5-01, corte 8).
 *
 * A turn used to be one call on `assistantService`, and the engine looked the
 * persona up inside it — the AI layer reaching up into the Office. Now the
 * agent composes its turn and the Office supplies the persona; a screen that
 * talked to one module would have to talk to three to do the same. This hook
 * is where they meet, the way `useInitiativeDelivery` joins two contexts that
 * must not import each other, and it keeps both chat screens under the UI
 * fan-out.
 *
 * Nothing here is state: the turns are module-level functions, returned as one
 * stable object so a screen can list it in a dependency array.
 */
import type { Settings } from '../types';
import type { Artifact } from '../lib/artifacts';
import type { Project } from '../services/architectureProjects';
import type { ChatMessage } from '../services/chat';
import type { AgentTurnResult, ProjectChatTurn } from '../services/ai';
import { processAssistantChat, processAssistantChatStream } from '../services/agent';
import { chatWithProject, officePersonaForMessage } from '../services/architectureOffice';

export interface AgentTurnInput {
  project: Project;
  activeArtifact: Artifact | null;
  history: ChatMessage[];
  question: string;
  settings: Settings;
}

export interface AssistantTurns {
  /** The Arquitecto Agente, speaking as whoever the question names. */
  askAgent(input: AgentTurnInput): Promise<AgentTurnResult>;
  /** The same turn, streamed. */
  streamAgent(input: AgentTurnInput, onDelta: (fullText: string, deltaText: string) => void): Promise<AgentTurnResult>;
  /** The project chat, answered by the Office. */
  chatWithProject(project: Project, message: string, history: readonly ProjectChatTurn[], settings: Settings): Promise<string>;
}

const withPersona = (input: AgentTurnInput) => ({ ...input, persona: officePersonaForMessage(input.question) });

const TURNS: AssistantTurns = {
  askAgent: (input) => processAssistantChat(withPersona(input)),
  streamAgent: (input, onDelta) => processAssistantChatStream(withPersona(input), onDelta),
  chatWithProject: (project, message, history, settings) => chatWithProject(project, message, history, settings),
};

export function useAssistantTurns(): AssistantTurns {
  return TURNS;
}

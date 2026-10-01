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
 * F5-02 put the rest of a chat screen's calls here too: the follow-ups a turn
 * triggers (the context note, the next artifacts to suggest), what a
 * `modifyArtifact` call means (`services/agent`), and how a failed turn is told
 * to the person. `AssistantPanel` reached three service modules for them.
 *
 * Nothing here is state: the turns are module-level functions, returned as one
 * stable object so a screen can list it in a dependency array.
 */
import { useMemo } from 'react';
import type { Settings } from '../types';
import type { Artifact, ArtifactContextPorts } from '../lib/artifacts';
import type { Project } from '../services/architectureProjects';
import type { ChatMessage } from '../services/chat';
import {
  AIServiceError,
  assistantService,
  classifyAIError,
  recommendationService,
  type AgentTurnResult,
  type ArtifactTemplateSuggestion,
  type ProjectChatTurn,
} from '../services/ai';
import {
  interpretArtifactModification,
  processAssistantChat,
  processAssistantChatStream,
  type ArtifactModification,
  type ModelFunctionCall,
} from '../services/agent';
import { chatWithProject, officePersonaForMessage } from '../services/architectureOffice';
import { useArtifactContextPorts } from './useArtifactContextPorts';

export interface AgentTurnInput {
  project: Project;
  activeArtifact: Artifact | null;
  history: ChatMessage[];
  question: string;
  settings: Settings;
  /** Initiative, deliverables and conversation; the hook fills it when it has the project (7.3d). */
  ports?: ArtifactContextPorts;
}

export interface AssistantTurns {
  /** The Arquitecto Agente, speaking as whoever the question names. */
  askAgent(input: AgentTurnInput): Promise<AgentTurnResult>;
  /** The same turn, streamed. */
  streamAgent(input: AgentTurnInput, onDelta: (fullText: string, deltaText: string) => void): Promise<AgentTurnResult>;
  /** The project chat, answered by the Office. */
  chatWithProject(project: Project, message: string, history: readonly ProjectChatTurn[], settings: Settings): Promise<string>;
  /** What a `modifyArtifact` call means for the open artifact. */
  interpretModification(functionCall: ModelFunctionCall | undefined, activeArtifact: Artifact | null, instruction?: string): ArtifactModification;
  /** A one-sentence context note the exchange established, or `null`. */
  extractContextNote(history: ChatMessage[], question: string, answer: string, settings: Settings): Promise<string | null>;
  /** The next artifacts worth generating for this project. */
  suggestNextArtifacts(project: Project, settings: Settings): Promise<ArtifactTemplateSuggestion[]>;
  /** How a failed turn is told to the person, and whether retrying helps. */
  describeFailure(error: unknown): TurnFailure;
}

export interface TurnFailure {
  readonly category: string;
  readonly status?: number;
  readonly message: string;
  readonly userMessage: string;
  readonly retryable: boolean;
}

/** How a failed turn is told to the person — shared by both chat screens. */
export const describeTurnFailure = (error: unknown): TurnFailure => {
  const friendly = error instanceof AIServiceError ? error : classifyAIError(error);
  return {
    category: friendly.category,
    status: friendly.status,
    message: friendly.message,
    userMessage: friendly.userMessage,
    retryable: friendly.retryable,
  };
};

const withPersona = (input: AgentTurnInput) => ({ ...input, persona: officePersonaForMessage(input.question) });

const TURNS: AssistantTurns = {
  askAgent: (input) => processAssistantChat(withPersona(input)),
  streamAgent: (input, onDelta) => processAssistantChatStream(withPersona(input), onDelta),
  chatWithProject: (project, message, history, settings) => chatWithProject(project, message, history, settings),
  interpretModification: interpretArtifactModification,
  extractContextNote: (history, question, answer, settings) =>
    assistantService.analyzeChatForContext(history, question, answer, settings),
  suggestNextArtifacts: (project, settings) => recommendationService.getSuggestedActions(project, settings),
  describeFailure: describeTurnFailure,
};

/**
 * With the project, the agent's turns carry the initiative, the deliverables
 * and the conversation as the canvas's own calls do (plan de calidad de
 * artefactos, 7.3d), read when each turn starts.
 */
export function useAssistantTurns(project?: Project): AssistantTurns {
  const loadContextPorts = useArtifactContextPorts(project);
  return useMemo<AssistantTurns>(() => (project ? {
    ...TURNS,
    askAgent: async (input) => processAssistantChat(withPersona({ ...input, ports: await loadContextPorts() })),
    streamAgent: async (input, onDelta) =>
      processAssistantChatStream(withPersona({ ...input, ports: await loadContextPorts() }), onDelta),
  } : TURNS), [project, loadContextPorts]);
}

/** What the answer says once a modification's write has been attempted. */
export { MODIFICATION_NOTES } from '../services/agent';

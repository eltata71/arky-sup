/**
 * The Arquitecto Agente's conversational turn, composed by the agent
 * (F5-01, corte 8).
 *
 * The engine used to compose it: this module's own system instruction and
 * chat-history budget, plus an Office persona it looked up by the mention in
 * the question. Composition is the agent's job, and the persona is the
 * caller's — whoever knows about the Office supplies an `AgentPersonaBriefing`
 * (`officePersonaForMessage`), exactly as the composer already asked for. The
 * agent still never learns that an Architecture Office exists.
 *
 * Buffered and streamed turns share one composition, so the model never sees
 * a different identity depending on whether the UI streamed.
 */
import type { Settings } from '../../types';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../architectureProjects';
import type { ChatMessage } from '../chat';
import { assistantService, type AgentTurnResult } from '../ai';
import {
  buildAgentSystemInstruction,
  prepareChatHistoryForModel,
  type AgentPersonaBriefing,
} from './agentContextComposer';

export interface AgentConversationTurn {
  project: Project;
  activeArtifact: Artifact | null;
  history: ChatMessage[];
  question: string;
  settings: Settings;
  /** The specialist for this turn. Absent → the agent's own voice. */
  persona?: AgentPersonaBriefing;
}

const composeTurn = ({ project, activeArtifact, history, question, settings, persona }: AgentConversationTurn) => ({
  systemInstruction: buildAgentSystemInstruction({ project, activeArtifact, settings, userQuery: question, persona }),
  history: prepareChatHistoryForModel({
    history,
    includeChatHistory: settings.aiConfig?.includeChatHistoryByDefault === true,
  }),
  question,
  settings,
  offerArtifactTool: activeArtifact !== null,
});

/** One buffered turn; `functionCall` carries a proposed `modifyArtifact`. */
export function processAssistantChat(turn: AgentConversationTurn): Promise<AgentTurnResult> {
  return assistantService.runAgentTurn(composeTurn(turn));
}

/** The same turn, streamed: `onDelta(fullText, deltaText)` per chunk. */
export function processAssistantChatStream(
  turn: AgentConversationTurn,
  onDelta: (fullText: string, deltaText: string) => void,
): Promise<AgentTurnResult> {
  return assistantService.streamAgentTurn(composeTurn(turn), onDelta);
}

/**
 * The patch: one turn that must come back as a `modifyArtifact` call carrying
 * the whole modified content. Anything else is a refusal the executor reports,
 * never an empty write.
 */
export async function requestArtifactPatch(turn: AgentConversationTurn): Promise<string> {
  const { functionCall } = await processAssistantChat(turn);
  if (!functionCall || functionCall.name !== 'modifyArtifact') {
    throw new Error('La IA no propuso una modificación aplicable.');
  }
  const candidate = typeof functionCall.args.newContent === 'string' ? functionCall.args.newContent : '';
  if (!candidate.trim()) throw new Error('La IA no devolvió contenido modificado.');
  return candidate;
}

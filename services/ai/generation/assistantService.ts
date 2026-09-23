/**
 * assistantService — domain entry point for conversational AI.
 *
 * Everything the user reaches by talking to the product: the project chat, the
 * agent assistant (buffered and streaming), multimodal input, the architecture
 * consultation and the analyses that read a conversation rather than an
 * artifact. All of it is the assistant vertical (`./assistant`, F5-01 cortes
 * 7 y 8), and none of it touches the engine.
 *
 * The turns that speak as an agent take their instruction composed. The
 * agent's turn is composed by `services/agent` (`processAssistantChat`) and
 * the project chat by the Office (`chatWithProject`): both import this layer,
 * so the persona is handed down, never looked up from here.
 */

import {
  analyzeChatForContext,
  buildProjectChatInstruction,
  consultArchitecture,
  generateProjectChatReply,
  processMultimodalChat,
  runAgentTurn,
  runConsistencyCheck,
  streamAgentTurn,
} from './assistant';

export const assistantService = {
  /** One agent turn over a composed instruction; reads back `modifyArtifact`. */
  runAgentTurn,
  /** Streamed agent turn. */
  streamAgentTurn,
  /** What the project says: base prompt and the summary of every artifact. */
  buildProjectChatInstruction,
  /** The project chat reply, over an instruction the Office has framed. */
  generateProjectChatReply,
  /** Assistant turn carrying uploaded files alongside the prompt. */
  processMultimodalChat,
  /** Architecture consultation over the current project. */
  consultArchitecture,
  /** Extract durable project context out of a conversation. */
  analyzeChatForContext,
  /** Cross-artifact consistency check. */
  runConsistencyCheck,
} as const;

export type AssistantService = typeof assistantService;
export type {
  AgentFunctionCall,
  AgentModelTurn,
  AgentTurnRequest,
  AgentTurnResult,
  ProjectChatReplyRequest,
  ProjectChatTurn,
} from './assistant';

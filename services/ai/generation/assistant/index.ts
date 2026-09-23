/**
 * The assistant vertical (F5-01, cortes 7 y 8). Nothing here composes a
 * persona: the three turns that speak as an agent receive their instruction
 * composed — the agent's by `services/agent`, the project chat's by the Office.
 */
export { consultArchitecture } from './architectureConsultation';
export { analyzeChatForContext, runConsistencyCheck } from './conversationAnalysis';
export { processMultimodalChat } from './multimodalChat';
export { runAgentTurn, streamAgentTurn } from './agentTurn';
export { buildProjectChatInstruction, generateProjectChatReply } from './projectChat';
export type { AssistantConversationTurn, AssistantCourseSummary } from './assistantPorts';
export type { AgentFunctionCall, AgentModelTurn, AgentTurnRequest, AgentTurnResult } from './agentTurn';
export type { ProjectChatReplyRequest, ProjectChatTurn } from './projectChat';

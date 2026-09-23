/**
 * Public surface of the agent layer.
 *
 * The UI imports from here; never reach into individual modules.
 */
export * from './agentTypes';
export { classifyAgentIntent } from './intentClassifier';
export { refineIntentWithLLM, LLM_REFINEMENT_THRESHOLD, __resetIntentClassifierCache } from './intentClassifierLLM';
export { planAgentAction } from './agentPlanner';
export { executeAgentAction } from './agentExecutor';
export { processAssistantChat, processAssistantChatStream, type AgentConversationTurn } from './agentConversation';
export type { AgentExecutorInput, AgentArtifactStore, AgentMemoryStore, AgentPhaseListener } from './agentExecutor';
export { extractMemoryBullets, fallbackBulletsFromInstruction, MEMORY_BULLET_LIMITS } from './memoryExtractor';
export { logAgentEvent, getTrace, subscribeAgentTrace, newTraceId } from './agentLogger';
export { detectProactiveSuggestion, type ProactiveSuggestion } from './proactiveDetector';
export { buildAgentActionRecord } from './agentRecord';
export {
  buildAgentSystemInstruction,
  prepareChatHistoryForModel,
  selectRelevantMemory,
  compactBullet,
  getAgentBaseMemory,
  DEFAULT_AGENT_MEMORY,
  DEFAULT_CONTEXT_BUDGET,
} from './agentContextComposer';
export type {
  AgentPersonaBriefing,
  BuildAgentSystemInstructionOptions,
  ContextBudget,
  PrepareChatHistoryOptions,
  PreparedChatTurn,
  SelectRelevantMemoryOptions,
} from './agentContextComposer';
export { agentActionRepository, type AgentActionRepository } from './AgentActionRepository';

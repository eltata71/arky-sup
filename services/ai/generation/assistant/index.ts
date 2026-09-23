/**
 * The assistant vertical (F5-01, corte 7): the parts of `assistantService`
 * that no longer live in the engine. The three persona-bound turns
 * (`chatWithProject`, `processAssistantChat` and its stream) stay behind until
 * their upward dependencies on the Office and the agent are cut.
 */
export { consultArchitecture } from './architectureConsultation';
export { analyzeChatForContext, runConsistencyCheck } from './conversationAnalysis';
export { processMultimodalChat } from './multimodalChat';
export type { AssistantConversationTurn, AssistantCourseSummary } from './assistantPorts';

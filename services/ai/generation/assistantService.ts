/**
 * assistantService — domain entry point for conversational AI.
 *
 * Everything the user reaches by talking to the product: the project chat, the
 * agent assistant (buffered and streaming), multimodal input, the architecture
 * consultation and the analyses that read a conversation rather than an
 * artifact.
 *
 * Four members are the assistant vertical (`./assistant`, F5-01 corte 7) and
 * no longer touch the engine. The three persona-bound turns still delegate to
 * it: each composes an Office persona and, for the agent, the agent's system
 * instruction, and both contexts import this layer back — so they leave once
 * that composition is supplied from outside rather than looked up from here.

 * Delegation is lazy: each member is a getter, so importing this façade does
 * not bind the whole engine. Eager binding made reaching for one method
 * construct every other one — the hidden cost that a façade exists to remove,
 * and a needless coupling for callers and tests alike.
 */

import { geminiService } from '../../geminiService';
import {
  analyzeChatForContext,
  consultArchitecture,
  processMultimodalChat,
  runConsistencyCheck,
} from './assistant';

export const assistantService = {
  /** Project-scoped chat turn. */
  get chatWithProject() {
    return geminiService.chatWithProject.bind(geminiService);
  },
  /** Agent assistant turn, buffered. */
  get processAssistantChat() {
    return geminiService.processAssistantChat.bind(geminiService);
  },
  /** Agent assistant turn, streamed. */
  get processAssistantChatStream() {
    return geminiService.processAssistantChatStream.bind(geminiService);
  },
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

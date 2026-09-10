/**
 * assistantService — domain entry point for conversational AI.
 *
 * Everything the user reaches by talking to the product: the project chat, the
 * agent assistant (buffered and streaming), multimodal input, the architecture
 * consultation and the analyses that read a conversation rather than an
 * artifact.
 *
 * Thin façade over the legacy engine; see `artifactGenerationService` for why
 * the indirection exists.

 * Delegation is lazy: each member is a getter, so importing this façade does
 * not bind the whole engine. Eager binding made reaching for one method
 * construct every other one — the hidden cost that a façade exists to remove,
 * and a needless coupling for callers and tests alike.
 */

import { geminiService } from '../../geminiService';

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
  get processMultimodalChat() {
    return geminiService.processMultimodalChat.bind(geminiService);
  },
  /** Architecture consultation over the current project. */
  get consultArchitecture() {
    return geminiService.consultArchitecture.bind(geminiService);
  },
  /** Extract durable project context out of a conversation. */
  get analyzeChatForContext() {
    return geminiService.analyzeChatForContext.bind(geminiService);
  },
  /** Cross-artifact consistency check. */
  get runConsistencyCheck() {
    return geminiService.runConsistencyCheck.bind(geminiService);
  },
} as const;

export type AssistantService = typeof assistantService;

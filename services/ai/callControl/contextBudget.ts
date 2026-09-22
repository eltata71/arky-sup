import type { AIConversationTurn } from '../core/AIContent';
import { estimatePayloadSize } from './aiCallControlService';

export interface BudgetedChatContext {
  messages: AIConversationTurn[];
  approximateSize: number;
  truncated: boolean;
}

export interface BudgetOptions {
  maxMessages: number;
  maxChars: number;
}

export function budgetChatHistory(
  history: readonly AIConversationTurn[],
  options: BudgetOptions,
): BudgetedChatContext {
  const relevant = history
    .filter(message => message.content.trim().length > 0)
    .slice(-options.maxMessages)
    .map(message => ({
      role: message.role,
      content: message.content.length > options.maxChars
        ? `${message.content.slice(0, options.maxChars)}… [recortado]`
        : message.content,
    }));

  let messages = relevant;
  while (estimatePayloadSize(messages) > options.maxChars && messages.length > 1) {
    messages = messages.slice(1);
  }

  return {
    messages,
    approximateSize: estimatePayloadSize(messages),
    truncated: messages.length !== history.length || relevant.some((message, index) => message.content !== history.slice(-options.maxMessages)[index]?.content),
  };
}

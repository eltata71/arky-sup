/**
 * The canonical tool contract.
 *
 * These types used to live in `services/ai/tools`, and `AIRequest.tools` was
 * `readonly unknown[]` with a comment explaining that the weakening existed
 * "to keep `core` free of a dependency on the tools module". The dependency it
 * avoided was on a *type*: `AIToolDefinition` is a declaration with no
 * behaviour, and a contract with no behaviour belongs at the bottom, next to
 * the request that carries it. What the `unknown[]` bought instead was three
 * adapters each writing `request.tools as AIToolDefinition[]` — an unchecked
 * assertion at every provider boundary, which is precisely where a wrong shape
 * becomes a 400 from someone else's API.
 *
 * `services/ai/tools` keeps what it should have kept: the per-provider
 * adapters. The vocabulary is here.
 */

import type { AIJsonSchema } from '../schema';
import type { AIToolCallPart, AIToolResultPart } from './AIContent';

/** One callable function offered to the model. */
export interface AIToolDefinition {
  /** Name the model echoes back when it calls this tool. */
  name: string;
  /** What the function does — the model reads this to decide when to call it. */
  description: string;
  /** Parameter shape, in the neutral schema dialect. */
  parameters: AIJsonSchema;
}

/**
 * A tool invocation the model asked for.
 *
 * Structurally the content part without its discriminant, and derived from it
 * rather than restated: two hand-written definitions of the same record drift,
 * and the drift shows up as a tool call that round-trips through a message and
 * loses its correlation id.
 */
export type AIToolCall = Omit<AIToolCallPart, 'kind'>;

/** The outcome of a tool invocation, handed back to the model. */
export type AIToolResult = Omit<AIToolResultPart, 'kind'>;

/** Lift a call into the content part that carries it in a message. */
export const toolCallPart = (call: AIToolCall): AIToolCallPart => ({ kind: 'tool-call', ...call });

/** Lift a result into the content part that carries it in a message. */
export const toolResultPart = (result: AIToolResult): AIToolResultPart => ({
  kind: 'tool-result',
  ...result,
});

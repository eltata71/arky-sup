/**
 * AIResponse — the provider-agnostic output contract.
 *
 * Every provider normalises its SDK response into this shape, with a fully
 * populated `AITrace` so callers get traceability for free.
 */

import type { AIToolCall } from './AITool';
import type { AITrace } from './AITrace';

/** Token/billing usage, as reported by the provider when available. */
export interface AIUsage {
  /** Tokens billed for the prompt. */
  promptTokens?: number;
  /** Tokens billed for the completion. */
  completionTokens?: number;
  /** Reasoning/thinking tokens, when the provider reports them separately. */
  thoughtsTokens?: number;
  /** Prompt tokens served from the provider's context cache, when reported.
   *  Billed differently from fresh prompt tokens, so cost cannot be derived
   *  without them. */
  cachedPromptTokens?: number;
  /** Total tokens. */
  totalTokens?: number;
  /** Wall-clock duration in ms. */
  durationMs: number;
  /** Time to the first streamed token, in ms — the latency a reader actually
   *  perceives, which `durationMs` does not report for a streamed answer. */
  timeToFirstTokenMs?: number;
}

/** Why the model stopped, normalised across backends. */
export type AIStopReason =
  | 'stop'          // the model finished its answer
  | 'length'        // the output token cap was reached
  | 'tool-call'     // the model is waiting for a tool result
  | 'content-filter'// the backend refused on safety grounds
  | 'error'
  | 'unknown';

export interface AIResponse<TStructured = unknown> {
  /** Generated text content (provider-normalised). */
  text: string;
  /** Parsed structured payload when `responseFormat: 'json'` was requested. */
  structured?: TStructured;
  /**
   * Tool calls the model asked for, in the canonical shape.
   *
   * Named `toolCalls`, not `functionCalls`, and carrying a `toolCallId`: a
   * result has to be correlated back to the call that produced it, and the
   * previous `{ name?, args? }` record had no way to say which call it
   * answered. Every field is required here because an adapter that cannot
   * report a name has not parsed a tool call.
   */
  toolCalls?: readonly AIToolCall[];
  /** Why generation stopped, normalised across backends. */
  stopReason?: AIStopReason;
  /** The backend's own finish reason, verbatim, for diagnostics. */
  finishReason?: string;
  /** The backend's own request id, when it returns one — the id to quote in a
   *  support ticket with that provider. */
  providerRequestId?: string;
  /** Usage/billing metadata. */
  usage: AIUsage;
  /** Full traceability record for the request. */
  trace: AITrace;
}

/** True when the response carries no usable text or structured content. */
export function isEmptyResponse(response: Pick<AIResponse, 'text' | 'structured' | 'toolCalls'>): boolean {
  const hasText = typeof response.text === 'string' && response.text.trim().length > 0;
  const hasStructured = response.structured !== undefined && response.structured !== null;
  const hasCalls = Array.isArray(response.toolCalls) && response.toolCalls.length > 0;
  return !hasText && !hasStructured && !hasCalls;
}

/**
 * Normalise a backend's finish string into an `AIStopReason`.
 *
 * The three shipped backends spell the same four outcomes six ways
 * (`STOP`/`end_turn`/`stop`, `MAX_TOKENS`/`max_tokens`/`length`, …). Callers
 * that branch on "did this get cut off?" should not have to know which one
 * answered.
 */
export function toStopReason(raw: string | undefined | null): AIStopReason | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === 'stop' || value === 'end_turn' || value === 'stop_sequence') return 'stop';
  if (value === 'max_tokens' || value === 'length') return 'length';
  if (value === 'tool_use' || value === 'tool_calls' || value === 'function_call') return 'tool-call';
  if (value === 'safety' || value === 'content_filter' || value === 'recitation') {
    return 'content-filter';
  }
  return 'unknown';
}

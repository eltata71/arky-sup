/**
 * AITrace — the full observability record for one AI request.
 *
 * The trace is the single artefact that explains *what happened*: which
 * provider/model served the request, whether fallback kicked in, how many
 * retries occurred, and the final outcome. It is built by `AITraceBuilder`
 * and attached to every `AIResponse` (and to thrown `AIError`s).
 */

import type { AIErrorCategory } from './AIError';
import type { AIGenerationModeId } from './AIRequest';
import type { AIProviderId, ModelSource, ModelTier } from './AIModel';
import type { AIUsage } from './AIResponse';
import type { AIRouteDecision } from '../routing/routeTypes';
import type { GuardrailFinding } from '../guardrails/guardrailTypes';

export type AITraceStatus = 'success' | 'error' | 'fallback' | 'aborted';

export interface AITrace {
  /** Stable request id returned to the caller. */
  requestId: string;
  /** Operation id grouping related requests, when provided. */
  operationId?: string;
  /** Logical purpose of the request. */
  purpose: string;
  /** Provider that ultimately served the request. */
  provider: AIProviderId;
  /** Provider the route started with, before any provider fallback. */
  providerRequested: AIProviderId;
  /** True when a different backend than the planned one served the request. */
  fallbackProviderUsed: boolean;
  /** Model the caller asked for (before any fallback). */
  modelRequested: string;
  /** Model that actually produced the response. */
  modelEffective: string;
  /** Where the model id was resolved from. */
  modelSource: ModelSource;
  /** True when a non-primary model in the chain served the request. */
  fallbackModelUsed: boolean;
  /** The fallback model id, when `fallbackModelUsed` is true. */
  fallbackModel?: string;
  /** Tier resolved by the router. */
  tier: ModelTier;
  /** Generation mode that drove model + parameter choice. */
  mode: AIGenerationModeId;
  /** Number of in-model retries that occurred. */
  retryCount: number;
  /** Per-attempt timeout that was in effect (ms). */
  timeoutMs: number;
  /** Total wall-clock duration (ms). */
  durationMs: number;
  /** Whether structured output was requested. */
  structuredOutput: boolean;
  /** Whether the request was streamed. */
  streaming: boolean;
  /** Final outcome status. */
  status: AITraceStatus;
  /** Error category when `status` is `error`/`fallback`. */
  errorCategory?: AIErrorCategory;
  /** True when the final content came from a deterministic local fallback. */
  localFallbackUsed: boolean;
  /** ContextPack id used to compose the prompt, when present. */
  contextPackId?: string;
  /** Usage metadata, when reported by the provider. */
  usage?: AIUsage;
  /**
   * How the backend was chosen: what was required, what was considered, what
   * was rejected and why.
   *
   * Optional because the legacy Gemini façade still routes through its own
   * model chain and has no plan to report. Absent means "not planned", never
   * "planned and unremarkable" — a decision with no record is the thing this
   * field exists to make visible.
   */
  routeDecision?: AIRouteDecision;
  /**
   * What the guardrails found, on either side of the call.
   *
   * Present even when nothing blocked: a `warning` that never reaches a trace
   * is a check nobody can act on, and the reason to record an injection signal
   * at all is that somebody may later have to reconstruct why an answer came
   * out strange. Absent means the request predates guardrails or produced no
   * finding at all.
   */
  guardrails?: readonly GuardrailFinding[];
  /** ISO timestamp when the request started. */
  startedAt: string;
  /** ISO timestamp when the request finished. */
  finishedAt: string;
}

/**
 * AIError — the single error type the `core` layer throws.
 *
 * Providers MUST translate their SDK-specific failures into an `AIError` so
 * callers can branch on `category` without inspecting provider-specific error
 * shapes. The category surface is intentionally stable across providers.
 */

import type { AIProviderId } from './AIModel';

/**
 * Categorical error surface, stable across providers.
 *
 * `empty-response` and `aborted` are first-class so the executor can branch
 * on them without string matching; `configuration` covers missing API keys
 * and other client-side setup faults.
 */
export type AIErrorCategory =
  | 'overloaded'         // 5xx / high demand — transient
  | 'rate-limit'         // 429 — transient but should not be hammered
  | 'auth'               // 401/403 — bad key, billing
  | 'invalid-request'    // 400 — malformed request
  | 'timeout'            // explicit timeout / abort by our timer
  | 'network'            // fetch failed / connection reset
  | 'malformed-response' // JSON/parser failure in SDK or model output
  | 'empty-response'     // provider returned no usable content
  | 'sdk'                // SDK runtime failure not covered above
  | 'configuration'      // missing API key / unconfigured client
  | 'aborted'            // caller-initiated cancellation
  | 'unknown';

/**
 * Where a failure came from, in terms the product owns.
 *
 * Distinct from `AIErrorCategory`, which says *what* went wrong: this says
 * *who* said so. The distinction earns its keep on rate limits — our own proxy
 * throttling a client and a provider throttling our proxy look identical to a
 * caller and need different answers.
 *
 * It lived in `services/geminiService.ts` as `AIErrorSource`, with a member
 * literally called `gemini-provider-rate-limit`, and the `services/ai` barrel
 * re-exported it. A vendor's name in the public API of the provider-agnostic
 * layer is a promise the layer does not keep — and the day OpenRouter is the
 * default it becomes a false one in every signature that uses it.
 */
export type AIErrorSource =
  | 'proxy-local-rate-limit'  // our serverless proxy throttled this client
  | 'provider-rate-limit'     // the model provider throttled our proxy
  | 'network'
  | 'auth'
  | 'overloaded'
  | 'configuration'
  | 'unknown';

export interface AIErrorInit {
  category: AIErrorCategory;
  provider: AIProviderId;
  /** Engineering-facing message (logged, never shown verbatim to users). */
  message: string;
  /** Localised, user-facing message safe to surface in the UI. */
  userMessage: string;
  /** Whether a retry could plausibly succeed. */
  retryable: boolean;
  /** HTTP status code when the failure originated from an HTTP response. */
  status?: number;
  /** Server-advised cool-down before the next attempt, in ms. */
  retryAfterMs?: number;
  /** Underlying error/cause for diagnostics. */
  cause?: unknown;
  /** Stable machine code for analytics/telemetry. */
  errorCode?: string;
}

export class AIError extends Error {
  public readonly category: AIErrorCategory;
  public readonly provider: AIProviderId;
  public readonly status?: number;
  public readonly retryable: boolean;
  public readonly userMessage: string;
  public readonly retryAfterMs?: number;
  public readonly cause?: unknown;
  public readonly errorCode?: string;

  constructor(init: AIErrorInit) {
    super(init.message);
    this.name = 'AIError';
    this.category = init.category;
    this.provider = init.provider;
    this.userMessage = init.userMessage;
    this.retryable = init.retryable;
    this.status = init.status;
    this.retryAfterMs = init.retryAfterMs;
    this.cause = init.cause;
    this.errorCode = init.errorCode;
  }

  /** Type guard — narrows an unknown error to `AIError`. */
  static is(error: unknown): error is AIError {
    return error instanceof AIError;
  }
}

/** Categories that the executor may retry without operator intervention. */
export const TRANSIENT_ERROR_CATEGORIES: ReadonlySet<AIErrorCategory> = new Set<AIErrorCategory>([
  'overloaded',
  'rate-limit',
  'timeout',
  'network',
  'malformed-response',
  'empty-response',
  'sdk',
]);

/** Categories that justify trying the next model in the fallback chain. */
export const MODEL_FALLBACK_CATEGORIES: ReadonlySet<AIErrorCategory> = new Set<AIErrorCategory>([
  'overloaded',
  'rate-limit',
  'invalid-request',
]);

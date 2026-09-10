/**
 * AIProvider — the abstract contract every AI backend must implement.
 *
 * The contract is deliberately *thin and single-attempt*: a provider performs
 * exactly one SDK round-trip per call and never retries, times out, or falls
 * back on its own. All orchestration (retry/timeout/model-fallback/tracing)
 * lives in `AIRequestExecutor`, so adding OpenAI/Anthropic is purely a matter
 * of implementing this interface — the UI and domain layers stay untouched.
 */

import type { AIProviderCapabilities } from './AICapabilities';
import type { AIError } from './AIError';
import type { AIProviderId } from './AIModel';
import type { AIRequest } from './AIRequest';
import type { AIResponse, AIUsage } from './AIResponse';
import type { AITextStream } from './AIStream';
import type { AIJsonSchema } from '../schema';

export interface AIProvider {
  /** Stable provider identity. */
  readonly id: AIProviderId;
  /** Human-readable provider name (for UIs and traces). */
  readonly name: string;

  /**
   * What this backend can do, declared once as a record.
   *
   * It replaces four loose `supportsX` booleans, and the difference is not
   * cosmetic: tool support was not among them, so `capabilities/negotiate`
   * read it through an optional cast that defaulted to *supported*. A provider
   * that could not call functions reported that it could, and the request ran
   * with the tools quietly dropped. A record makes the set enumerable and its
   * members mandatory — adding a capability is now a compile error in every
   * adapter instead of a silent `false`.
   */
  readonly capabilities: AIProviderCapabilities;

  /** Perform a single one-shot text generation. */
  generateText(request: AIRequest): Promise<AIResponse>;

  /**
   * Perform a single structured (JSON) generation. `schema` is a
   * provider-neutral JSON schema; the provider adapts it to its SDK format.
   * The returned `AIResponse.structured` carries the parsed payload.
   */
  generateStructured<T = unknown>(request: AIRequest, schema?: AIJsonSchema): Promise<AIResponse<T>>;

  /** Open a single streaming generation. */
  streamText(request: AIRequest): Promise<AITextStream>;

  /** Translate an arbitrary (SDK or generic) error into a canonical `AIError`. */
  classifyError(error: unknown): AIError;

  /** Extract/normalise usage metadata from a completed response. */
  estimateUsage(response: AIResponse): AIUsage;
}

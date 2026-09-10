/**
 * aiGateway — the low-level generation surface.
 *
 * Domain code should reach for a domain façade (`artifactGenerationService`,
 * `assistantService`, …). This is for the layers that legitimately compose
 * their own prompts and need the shared pipeline underneath: the agent
 * executor, the Architecture Office coordinator, the chat compactor.
 *
 * What it guarantees is the part those callers must not re-implement: provider
 * selection, the serverless proxy attempt, retry with backoff, per-attempt
 * timeout and model fallback.
 *
 * It deliberately exposes no provider-specific predicate. A neutral surface
 * that answers "is this OpenRouter?" invites callers to branch on the backend,
 * which is the coupling the rest of this layer exists to remove — ask
 * `capabilities` what the provider can do instead. Calling a provider SDK directly instead is what
 * once made guided creation surface a single 429 as a hard error while artifact
 * generation quietly fell back to a smaller model.
 */

import type { Settings } from '../../../types';
import { geminiService } from '../../geminiService';

/** Options shared by both gateway calls. */
export interface AIGatewayOptions {
  timeoutMs?: number;
  maxCandidates?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

/** Result of a buffered generation. */
export interface AIGatewayResult {
  text: string;
  functionCalls?: Array<{ name?: string; args?: Record<string, unknown> }>;
}

/**
 * The gateway is typed explicitly rather than inferred from the bound methods.
 *
 * `geminiService` sits on an import cycle with the agent and chat modules that
 * use this gateway, and TypeScript degrades inference across such a cycle —
 * callers silently received `unknown` and lost `.text`. Declaring the shape
 * here pins the contract independently of resolution order, which is also the
 * right thing for a published surface.
 */
export interface AIGateway {
  generateContent(
    settings: Settings,
    preferredModel: string,
    contents: unknown,
    config?: Record<string, unknown>,
    options?: AIGatewayOptions,
  ): Promise<AIGatewayResult>;

  generateContentStream(
    settings: Settings,
    preferredModel: string,
    contents: unknown,
    config?: Record<string, unknown>,
    options?: AIGatewayOptions,
  ): Promise<AsyncIterable<unknown>>;

}

export const aiGateway: AIGateway = {
  /** One-shot generation through the full provider/retry/fallback pipeline. */
  generateContent: (settings, preferredModel, contents, config, options) =>
    geminiService.generateContentWithFallback(settings, preferredModel, contents, config, options),
  /** Streaming generation through the same pipeline. */
  generateContentStream: (settings, preferredModel, contents, config, options) =>
    geminiService.generateContentStreamWithFallback(settings, preferredModel, contents, config, options),
};

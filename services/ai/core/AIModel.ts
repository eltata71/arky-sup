/**
 * AIModel — provider-agnostic model identity primitives.
 *
 * Re-exports the canonical Gemini model tables so the rest of the `core`
 * layer never spreads literal model strings, and adds provider-neutral
 * descriptors a router can produce and a trace can record.
 */

import {
  DEFAULT_TEXT_MODEL,
  IMAGE_MODEL,
  MODEL_FALLBACK_CHAIN,
  MODEL_TIERS,
  TTS_MODEL,
  type ModelSource,
  type ModelTier,
} from '../../../lib/ai/modelCatalog';

export {
  DEFAULT_TEXT_MODEL,
  IMAGE_MODEL,
  MODEL_FALLBACK_CHAIN,
  MODEL_TIERS,
  TTS_MODEL,
};
export type { ModelSource, ModelTier };

/** Logical model tier — alias kept stable for the `core` public surface. */
export type AIModelTier = ModelTier;

/** Identity of an AI backend implementation. */
export type AIProviderId = 'gemini' | 'openrouter' | 'openai' | 'anthropic' | 'azure' | 'mock';

/**
 * Concrete model the router resolved for a request, together with the
 * attribution needed to explain the decision in a trace.
 */
export interface AIModelDescriptor {
  /** Concrete model id sent to the provider SDK. */
  id: string;
  /** Tier the router resolved for the request. */
  tier: AIModelTier;
  /** Where the id was resolved from (user/global/tier-floor/fallback). */
  source: ModelSource;
  /** Original requested model id (verbatim from settings/override), if any. */
  requested?: string;
  /** Ordered fallback chain to try if the primary model fails. */
  fallbackChain: readonly string[];
}

/** True when `model` is a recognised member of the canonical fallback chain. */
export function isKnownTextModel(model: string): boolean {
  return MODEL_FALLBACK_CHAIN.includes(model);
}

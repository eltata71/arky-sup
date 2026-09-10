/**
 * `services/ai/providers/anthropic` — the Claude adapter.
 */

export { AnthropicProvider, anthropicDelta } from './AnthropicProvider';
export type { AnthropicProviderOptions } from './AnthropicProvider';
export {
  ANTHROPIC_FALLBACK_CHAIN,
  ANTHROPIC_MODEL_TIERS,
  acceptsTemperature,
} from './anthropicModels';
export { resolveAnthropicApiKey } from './anthropicApiKey';

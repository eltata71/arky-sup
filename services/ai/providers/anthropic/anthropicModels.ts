/**
 * Model catalog for the Anthropic provider.
 *
 * Tiers map onto the Claude family the way the other catalogs map onto theirs:
 * a cheap model for mechanical hops, a balanced default, and a deep tier for
 * work that repays the reasoning.
 */

export const ANTHROPIC_MODEL_TIERS = {
  quick: 'claude-haiku-4-5',
  default: 'claude-sonnet-5',
  deep: 'claude-opus-5',
} as const;

export type AnthropicModelTier = keyof typeof ANTHROPIC_MODEL_TIERS;

/** Ordered fallback chain tried when a model is unavailable. */
export const ANTHROPIC_FALLBACK_CHAIN: readonly string[] = [
  ANTHROPIC_MODEL_TIERS.default,
  ANTHROPIC_MODEL_TIERS.deep,
  ANTHROPIC_MODEL_TIERS.quick,
];

/**
 * Models that reject a `temperature` parameter outright.
 *
 * Sampling controls were removed on the newest Claude models: sending
 * `temperature` returns a 400 rather than being ignored. The neutral
 * `AIRequest` carries a temperature for every provider, so the adapter has to
 * know which of its own models will not accept one — exactly the kind of
 * per-backend detail the provider layer exists to absorb.
 */
const NO_SAMPLING = /^claude-(opus-5|sonnet-5|fable-5|mythos-5)/;

export const acceptsTemperature = (model: string): boolean =>
  !NO_SAMPLING.test(model.trim());

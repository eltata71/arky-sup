/**
 * ProviderModelCatalog — every provider owns its own model space.
 *
 * Model resolution used to read from one global table of Gemini ids, which
 * made the tier system a Gemini concept that the other providers borrowed. The
 * visible symptom was concrete: the `quick` tier returned `gemini-2.5-flash-lite`
 * unconditionally — a deliberate cost floor — and forwarded that id to
 * OpenRouter, whose catalog has never heard of it.
 *
 * The fix is to invert ownership. The router no longer *knows* the models; it
 * asks the active provider's catalog. A tier floor stays a floor, but it is
 * that provider's floor.
 */

import type { AIProviderId, ModelSource, ModelTier } from '../core/AIModel';

export interface ProviderModelCatalog {
  /** Provider this catalog belongs to. */
  readonly provider: AIProviderId;

  /** Concrete model id for each logical tier, in this provider's id space. */
  readonly tiers: Readonly<Record<ModelTier, string>>;

  /** Ordered fallback chain tried when a model is unavailable. */
  readonly fallbackChain: readonly string[];

  /** Model used when nothing else resolves. */
  readonly defaultModel: string;

  /**
   * True when `modelId` belongs to this provider's id space.
   *
   * This is the guard that stops a foreign id from being forwarded. It is
   * intentionally a *recognition* test rather than a membership test against
   * a fixed list: provider catalogs move faster than this repository, so a
   * model released last week must still be usable.
   */
  owns(modelId: string): boolean;

  /**
   * Canonicalise an id this catalog owns — collapsing a retired alias onto the
   * model that replaced it, for instance. Optional: a provider with no aliases
   * needs no rule. Applied after `owns`, so it only ever sees its own ids.
   */
  normalize?(modelId: string): string;
}

/**
 * Resolution of a tier against a catalog, with the attribution a trace needs
 * to explain which configuration layer won.
 */
export interface CatalogResolution {
  /** Concrete model id, guaranteed to belong to `catalog.provider`. */
  id: string;
  /** Which layer decided it. */
  source: ModelSource;
  /** Tier that was asked for. */
  tier: ModelTier;
  /** What the caller originally asked for, when that differs. */
  requested?: string;
}

/**
 * Resolve a tier to a concrete model within one provider's space.
 *
 * Precedence, high → low:
 *   1. A requested model this catalog owns — except on `quick`, which is a
 *      deliberate cost floor for mechanical hops.
 *   2. The catalog's tier model.
 *   3. The catalog's default model.
 *
 * A requested model the catalog does *not* own is not an error and not a
 * passthrough: it is recorded as `requested` and replaced by this provider's
 * tier model. Passing it through is what produced the original defect, and
 * failing would strand any user whose stored model predates a provider switch.
 */
export function resolveInCatalog(
  catalog: ProviderModelCatalog,
  tier: ModelTier,
  requestedModel?: string,
): CatalogResolution {
  const requested = requestedModel?.trim();
  const tierModel = catalog.tiers[tier] ?? catalog.defaultModel;

  if (!requested) {
    return { id: tierModel, source: 'global', tier };
  }

  if (!catalog.owns(requested)) {
    // Foreign id — the user's preference belongs to a different provider.
    return { id: tierModel, source: 'fallback', tier, requested };
  }

  if (tier === 'quick') {
    // The floor is honoured, but it is this provider's floor.
    return { id: tierModel, source: 'tier-floor', tier, requested };
  }

  const canonical = catalog.normalize ? catalog.normalize(requested) : requested;
  return { id: canonical, source: 'user', tier, requested };
}

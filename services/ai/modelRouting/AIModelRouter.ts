/**
 * AIModelRouter — resolves a high-level mode/tier into a concrete model id.
 *
 * The router is provider-agnostic because it does not know any models: it asks
 * the active provider's catalog. That inversion is what keeps a tier from
 * meaning "a Gemini model" — a tier floor is still a floor, but it is the
 * floor of whichever provider is serving the request.
 */

import type { Settings } from '../../../types';
import { type ModelTier } from '../../../lib/ai/modelCatalog';
import { catalogForSettings, resolveModelForSettings } from '../catalog';
import { AI_POLICIES } from '../core/AIPolicy';
import type { AIModelDescriptor, AIModelTier } from '../core/AIModel';
import type { AIGenerationModeId } from '../core/AIRequest';

export interface RouteInput {
  /** Generation mode — selects the default tier when `tier` is absent. */
  mode?: AIGenerationModeId;
  /** Explicit tier hint — wins over the mode-derived tier. */
  tier?: AIModelTier;
  /** Explicit model id override — wins over tier resolution. */
  modelOverride?: string;
  /** Settings carrier — supplies the user's preferred model. */
  settings?: Settings;
}

export class AIModelRouter {
  /** Resolve the tier for a mode, honouring an explicit override. */
  resolveTier(mode: AIGenerationModeId = 'balanced', explicitTier?: ModelTier): ModelTier {
    if (explicitTier) return explicitTier;
    return (AI_POLICIES[mode] ?? AI_POLICIES.balanced).modelTier;
  }

  /**
   * Resolve the model that should serve the request.
   *
   * Precedence (high → low):
   *   1. `modelOverride`, when the active provider's catalog owns it.
   *   2. `settings.aiConfig.model` for non-`quick` tiers — user preference.
   *   3. The catalog's tier model.
   *   4. The catalog's default model.
   *
   * An override the catalog does not own is recorded but not forwarded. That
   * single rule is what stops a Gemini tier id from reaching OpenRouter, which
   * is how the "agnostic" path used to fail: the request succeeded in shape and
   * named a model the backend had never heard of.
   */
  route(input: RouteInput): AIModelDescriptor {
    const mode: AIGenerationModeId = input.mode ?? 'balanced';
    const tier = this.resolveTier(mode, input.tier);
    const catalog = catalogForSettings(input.settings);
    const override = input.modelOverride?.trim();

    if (override && catalog.owns(override)) {
      return {
        id: override,
        tier,
        source: 'user',
        requested: override,
        fallbackChain: this.buildFallbackChain(override, input.settings),
      };
    }

    const resolved = resolveModelForSettings(tier, input.settings);
    // A foreign override still deserves attribution: the trace should say what
    // was asked for, not silently show the substitute as if it were the choice.
    const requested = override ?? resolved.requested;
    return {
      id: resolved.id,
      tier,
      source: override ? 'fallback' : resolved.source,
      requested,
      fallbackChain: this.buildFallbackChain(resolved.id, input.settings),
    };
  }

  /** Ordered fallback chain for the active provider, excluding the primary. */
  buildFallbackChain(primary: string, settings?: Settings): readonly string[] {
    return catalogForSettings(settings).fallbackChain.filter((m) => m !== primary);
  }

  /** Tier → model id table for the active provider. */
  tierTable(settings?: Settings): Readonly<Record<ModelTier, string>> {
    return catalogForSettings(settings).tiers;
  }
}

/** Shared router instance. */
export const aiModelRouter = new AIModelRouter();

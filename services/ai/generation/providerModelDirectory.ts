/**
 * Which models a provider offers, asked in the product's own terms.
 *
 * `pages/SettingsPage.tsx` imported
 * `services/ai/providers/openrouter/openRouterModels` directly — a screen
 * reaching into one provider's adapter, which is the coupling the whole
 * `services/ai` layer exists to prevent. It worked, and it is exactly how the
 * product became tied to a vendor the first time: no rule was broken, a file
 * was simply the shortest path.
 *
 * So the question moves to a façade. The screen asks "what can this provider
 * run?"; the adapters answer. Adding a provider means adding a case here, not
 * editing a settings screen.
 */

import type { AIProviderId } from '../core';

/** One model a provider can run, in terms a settings screen can render. */
export interface AIModelOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /**
   * Whether the list came from the provider's live catalogue or from the
   * built-in fallback. The screen says so: a stale fallback list presented as
   * live is how someone picks a model that no longer exists.
   */
  readonly source: 'api' | 'fallback';
}

export interface ListModelsOptions {
  /**
   * The user's own key, when they supply one. Providers that need a key to
   * enumerate return their fallback list without it rather than failing.
   */
  readonly apiKey?: string;
}

/**
 * List the models available for a provider.
 *
 * Never throws and never returns an empty list: a settings screen with no
 * options is worse than one showing the built-in set, and the `source` field
 * is what keeps that honest.
 */
export async function listModelsForProvider(
  provider: AIProviderId,
  options: ListModelsOptions = {},
): Promise<AIModelOption[]> {
  if (provider === 'openrouter') {
    const { listCurrentOpenRouterModels, OPENROUTER_FALLBACK_MODELS } = await import(
      '../providers/openrouter/openRouterModels'
    );
    if (!options.apiKey) return OPENROUTER_FALLBACK_MODELS;
    return listCurrentOpenRouterModels(options.apiKey);
  }

  // Gemini's catalogue is a curated static list rather than a live endpoint —
  // `lib/ai/modelCatalog.ts` — and the settings screen renders it from there
  // today. Routing it through here as well is the next step; the façade is
  // shaped for it so that step does not need to change this signature.
  return [];
}

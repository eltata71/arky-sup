/**
 * The shipped provider catalogs and the registry that resolves one.
 *
 * Each catalog is small on purpose: a tier table, a fallback chain, a default,
 * and the rule for recognising its own ids. Adding a provider means adding a
 * catalog here and registering it — the router and every call site stay as
 * they are.
 */

import type { Settings } from '../../../types';
import {
  DEFAULT_TEXT_MODEL,
  MODEL_FALLBACK_CHAIN,
  MODEL_TIERS,
  resolveTextModel,
} from '../../../lib/ai/modelCatalog';
import { OPENROUTER_MODEL_TIERS } from '../providers/openrouter/openRouterModels';
import {
  ANTHROPIC_FALLBACK_CHAIN,
  ANTHROPIC_MODEL_TIERS,
} from '../providers/anthropic/anthropicModels';
import type { AIProviderId, ModelTier } from '../core/AIModel';
import {
  resolveInCatalog,
  type CatalogResolution,
  type ProviderModelCatalog,
} from './ProviderModelCatalog';

/* ------------------------------------------------------------------ Gemini */

export const geminiCatalog: ProviderModelCatalog = {
  provider: 'gemini',
  tiers: MODEL_TIERS,
  fallbackChain: MODEL_FALLBACK_CHAIN,
  defaultModel: DEFAULT_TEXT_MODEL,
  owns(modelId: string): boolean {
    const id = modelId.trim().toLowerCase();
    // Google's text models are all `gemini-*`; `models/` is the prefix the
    // REST listing returns and that users sometimes paste verbatim.
    return id.startsWith('gemini-') || id.startsWith('models/gemini-');
  },
  // Retired preview ids still sit in stored settings; collapse them onto the
  // model that replaced them rather than sending a name the API has dropped.
  normalize: (modelId: string) => resolveTextModel(modelId),
};

/* -------------------------------------------------------------- OpenRouter */

/**
 * OpenRouter addresses models as `vendor/model` (`anthropic/claude-3.5-sonnet`,
 * `openrouter/auto`). That slug shape is the recognition rule — enumerating the
 * catalog would go stale within weeks, and a user who pastes a model released
 * yesterday should not be told it does not exist.
 */
export const openRouterCatalog: ProviderModelCatalog = {
  provider: 'openrouter',
  tiers: OPENROUTER_MODEL_TIERS,
  fallbackChain: [OPENROUTER_MODEL_TIERS.default],
  defaultModel: OPENROUTER_MODEL_TIERS.default,
  owns(modelId: string): boolean {
    const id = modelId.trim();
    if (id.length === 0) return false;
    // A bare `gemini-2.5-flash` has no slash and is Google's id, not a slug.
    return id.includes('/');
  },
};

/* ---------------------------------------------------------------- Anthropic */

/**
 * Claude ids are all `claude-*`, so the recognition rule is a prefix — the same
 * shape of rule as the other two catalogs, which is the point: adding a
 * provider did not require a new kind of answer.
 */
export const anthropicCatalog: ProviderModelCatalog = {
  provider: 'anthropic',
  tiers: ANTHROPIC_MODEL_TIERS,
  fallbackChain: ANTHROPIC_FALLBACK_CHAIN,
  defaultModel: ANTHROPIC_MODEL_TIERS.default,
  owns(modelId: string): boolean {
    return /^claude-/i.test(modelId.trim());
  },
};

/* ---------------------------------------------------------------- registry */

const CATALOGS: Partial<Record<AIProviderId, ProviderModelCatalog>> = {
  gemini: geminiCatalog,
  openrouter: openRouterCatalog,
  anthropic: anthropicCatalog,
};

/** Register a catalog for a provider. Used when a new provider is added. */
export function registerCatalog(catalog: ProviderModelCatalog): void {
  CATALOGS[catalog.provider] = catalog;
}

/** Providers that currently have a catalog. */
export function registeredCatalogProviders(): AIProviderId[] {
  return Object.keys(CATALOGS) as AIProviderId[];
}

/**
 * The provider a request should run against.
 *
 * `aiConfig.provider` was added after the first releases, so stored settings
 * may not carry it. Those records resolve to `gemini` in memory, which is what
 * they were implicitly using — the same lazy-migration rule the portfolio graph
 * applies to legacy links, and for the same reason: nothing has to be rewritten
 * before the app works.
 */
export function resolveProviderId(settings?: Settings): AIProviderId {
  const declared = settings?.aiConfig?.provider;
  if (declared && declared !== 'gemini' && CATALOGS[declared]) return declared;
  return 'gemini';
}

/**
 * Providers the serverless proxy can route to.
 *
 * The proxy holds server-side keys and speaks each backend's wire format, so a
 * provider is only proxyable once `api/ai.ts` knows it. A provider outside this
 * set is not an error: the caller falls back to the direct path, exactly as it
 * does when no proxy is configured at all.
 */
const PROXYABLE: ReadonlySet<AIProviderId> = new Set<AIProviderId>(['gemini', 'openrouter']);

/** The proxy's name for this provider, or `null` when it cannot be proxied. */
export function proxyProviderFor(settings?: Settings): 'gemini' | 'openrouter' | null {
  const provider = resolveProviderId(settings);
  return PROXYABLE.has(provider) ? (provider as 'gemini' | 'openrouter') : null;
}

/** Catalog for a provider, falling back to Gemini's for an unregistered one. */
export function catalogFor(provider: AIProviderId): ProviderModelCatalog {
  return CATALOGS[provider] ?? geminiCatalog;
}

/** Catalog for the provider these settings select. */
export function catalogForSettings(settings?: Settings): ProviderModelCatalog {
  return catalogFor(resolveProviderId(settings));
}

/**
 * Resolve a tier to a concrete model for whichever provider the settings
 * select. This is the provider-aware replacement for the Gemini-only
 * `resolveEffectiveModel`, and the single entry point every call site should
 * use to turn a tier into a model id.
 */
export function resolveModelForSettings(
  tier: ModelTier,
  settings?: Settings,
): CatalogResolution {
  const catalog = catalogForSettings(settings);
  return resolveInCatalog(catalog, tier, settings?.aiConfig?.model);
}

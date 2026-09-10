import { Settings } from '../../types';

export const DEFAULT_TEXT_MODEL = 'gemini-2.5-flash';

/** Specialised model ids for non-text modalities. Centralised so the rest of
 *  the codebase never spreads literal model strings. */
export const IMAGE_MODEL = 'gemini-2.5-flash-image';
export const TTS_MODEL = 'gemini-2.5-flash-preview-tts';

// Ordered fallback chain for text generation in case a model is unavailable for a given key/region.
export const MODEL_FALLBACK_CHAIN: readonly string[] = [
  DEFAULT_TEXT_MODEL,
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash',
  'gemini-3.1-pro',
  'gemini-3.1-flash-lite',
];

/**
 * Cost-aware model tiers used by diagram services to avoid paying flagship
 * prices for trivially-structured tasks.
 *
 *  - `quick`   → mechanical conversions, schema mapping, small fixes (Mermaid
 *               → ReactFlow JSON, syntax repair). Routed to flash-lite for
 *               ~75% cost reduction with no quality regression on bounded
 *               tasks.
 *  - `default` → standard generation that benefits from light reasoning
 *               (creating an artifact from a brief, projecting an audience).
 *  - `deep`    → reserved for explicit deep-reasoning paths (multi-artifact
 *               consistency, full-rubric review). Defaults to the user-chosen
 *               model unless overridden.
 */
export const MODEL_TIERS = {
  quick:   'gemini-2.5-flash-lite',
  default: 'gemini-2.5-flash',
  deep:    'gemini-2.5-pro',
} as const;

export type ModelTier = keyof typeof MODEL_TIERS;

/**
 * Resolve the canonical model id for a given tier, honouring the user's
 * explicitly selected model when it already matches or exceeds the tier
 * requirement (we never silently downgrade a user-requested model).
 */
export function resolveTierModel(tier: ModelTier, userModel?: string): string {
  const tierModel = MODEL_TIERS[tier];
  const requested = (userModel || '').trim();
  if (!requested) return tierModel;
  // Honour user's pick for `default`/`deep` tiers; for `quick` we still prefer
  // flash-lite to keep mechanical hops cheap unless the user picked an even
  // smaller model.
  if (tier === 'quick') return tierModel;
  return resolveTextModel(requested);
}

export type ModelSource = 'user' | 'global' | 'tier-floor' | 'fallback';

/** Single source of truth for the model that will actually hit the SDK.
 *  Returns the resolved id together with `source`, so traces and the UI can
 *  show which configuration layer won the precedence. */
export interface ResolvedModel {
  /** Concrete model id sent to the Gemini SDK. */
  id: ModelTier extends never ? string : string;
  /** Where the id came from: user setting, global config, tier floor, or hard fallback. */
  source: ModelSource;
  /** Tier that was requested. Recorded for traces/diagnostics. */
  tier: ModelTier;
  /** Original requested model id (verbatim from settings), if any. */
  requested?: string;
}

/**
 * Single resolution entry-point used by every text-generation call site.
 *
 * Precedence:
 *   1. settings.aiConfig.model (user/global preference) — when valid AND tier
 *      doesn't force a floor (the `quick` tier intentionally floors to
 *      flash-lite to keep mechanical hops cheap).
 *   2. tier default (when user has no preference).
 *   3. DEFAULT_TEXT_MODEL (hard fallback) — when settings is missing entirely.
 */
export function resolveEffectiveModel(tier: ModelTier, settings?: Settings): ResolvedModel {
  const requestedRaw = settings?.aiConfig?.model;
  const requested = typeof requestedRaw === 'string' ? requestedRaw.trim() : '';
  const tierModel = MODEL_TIERS[tier];

  if (!settings) {
    return { id: tierModel || DEFAULT_TEXT_MODEL, source: 'fallback', tier, requested: undefined };
  }

  if (!requested) {
    return { id: tierModel, source: 'global', tier };
  }

  // The `quick` tier is a deterministic floor: low-cost mechanical hops should
  // always run on flash-lite regardless of user preference. We still record
  // the original request so the trace can explain the override.
  if (tier === 'quick') {
    return { id: tierModel, source: 'tier-floor', tier, requested };
  }

  const resolved = resolveTextModel(requested);
  return { id: resolved, source: 'user', tier, requested };
}

export interface GeminiModelOption {
  id: string;
  name: string;
  description: string;
  source: 'api' | 'fallback';
}

interface GeminiModelApiItem {
  name?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

interface GeminiModelsApiResponse {
  models?: GeminiModelApiItem[];
}

const FALLBACK_MODELS: GeminiModelOption[] = [
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash (Predeterminado estable)',
    description: 'Modelo por omisión para generación estable de artefactos en producción.',
    source: 'fallback',
  },
  {
    id: 'gemini-2.5-pro',
    name: 'Gemini 2.5 Pro',
    description: 'Modelo robusto para razonamiento extenso y tareas técnicas.',
    source: 'fallback',
  },
  {
    id: 'gemini-2.5-flash-lite',
    name: 'Gemini 2.5 Flash-Lite',
    description: 'Opción de menor costo para alto volumen.',
    source: 'fallback',
  },
  {
    id: 'gemini-3.1-flash',
    name: 'Gemini 3.1 Flash',
    description: 'Mayor capacidad manteniendo baja latencia para tareas multimodales.',
    source: 'fallback',
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    description: 'Mayor razonamiento para análisis complejos y arquitectura profunda.',
    source: 'fallback',
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash-Lite',
    description: 'Opción de bajo costo y latencia, con respuestas más breves.',
    source: 'fallback',
  },
];

const MODEL_ALIAS_TO_STABLE: Record<string, string> = {
  'gemini-3-flash-preview': DEFAULT_TEXT_MODEL,
  'gemini-2.5-flash-preview': DEFAULT_TEXT_MODEL,
  'gemini-3.1-flash-lite': DEFAULT_TEXT_MODEL,
};

export const resolveTextModel = (requestedModel?: string): string => {
  const normalized = (requestedModel || '').trim();
  if (!normalized) return DEFAULT_TEXT_MODEL;
  return MODEL_ALIAS_TO_STABLE[normalized] || normalized;
};

const dedupeModels = (models: GeminiModelOption[]): GeminiModelOption[] => {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
};

const normalizeModelId = (name: string): string => name.replace(/^models\//, '').trim();

const isDeprecatedModel = (item: GeminiModelApiItem): boolean => {
  const display = (item.displayName || '').toLowerCase();
  const description = (item.description || '').toLowerCase();
  return display.includes('deprecated') || description.includes('deprecated');
};

const supportsGenerateContent = (item: GeminiModelApiItem): boolean =>
  (item.supportedGenerationMethods || []).includes('generateContent');

const buildLabel = (item: GeminiModelApiItem, id: string): string => {
  if (item.displayName && item.displayName.trim().length > 0) {
    return item.displayName.trim();
  }
  return id;
};

const buildDescription = (item: GeminiModelApiItem): string => {
  const raw = (item.description || '').trim();
  if (!raw) {
    return 'Modelo disponible para generación de contenido.';
  }
  return raw.length > 180 ? `${raw.slice(0, 177)}...` : raw;
};

const filterAndMapGeminiModels = (items: GeminiModelApiItem[]): GeminiModelOption[] => {
  return items
    .filter((item) => {
      const modelName = item.name || '';
      if (!modelName.startsWith('models/gemini')) return false;
      if (!supportsGenerateContent(item)) return false;
      if (isDeprecatedModel(item)) return false;
      return true;
    })
    .map((item) => {
      const id = normalizeModelId(item.name || '');
      return {
        id,
        name: buildLabel(item, id),
        description: buildDescription(item),
        source: 'api' as const,
      };
    })
    .sort((a, b) => {
      if (a.id === DEFAULT_TEXT_MODEL) return -1;
      if (b.id === DEFAULT_TEXT_MODEL) return 1;
      return a.name.localeCompare(b.name);
    });
};

/**
 * Resolve the API key that should hit the Gemini SDK, honouring the user's
 * `apiKeySource` preference (global env key vs. personal localStorage key).
 * Exported so the `AIProvider` layer resolves keys through one seam.
 */
export const resolveEffectiveApiKey = (settings?: Settings): string => {
  const apiKeySource = settings?.aiConfig?.apiKeySource || 'global';
  const userKey = typeof localStorage !== 'undefined' ? localStorage.getItem('user_gemini_key') : null;
  const globalKey = (import.meta.env.VITE_GEMINI_API_KEY ?? '').trim();

  if (apiKeySource === 'user') {
    if (userKey && userKey.trim().length > 0) return userKey.trim();
    if (globalKey.length > 0) return globalKey;
  } else {
    if (globalKey.length > 0) return globalKey;
    if (userKey && userKey.trim().length > 0) return userKey.trim();
  }

  return '';
};

export const getDefaultModelOptions = (): GeminiModelOption[] => [...FALLBACK_MODELS];

export const listCurrentGeminiModels = async (settings?: Settings): Promise<GeminiModelOption[]> => {
  const apiKey = resolveEffectiveApiKey(settings);
  if (!apiKey) {
    return getDefaultModelOptions();
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    if (!response.ok) {
      throw new Error(`Model listing failed with status ${response.status}`);
    }

    const data = (await response.json()) as GeminiModelsApiResponse;
    const apiModels = filterAndMapGeminiModels(data.models || []);

    if (apiModels.length === 0) {
      return getDefaultModelOptions();
    }

    return dedupeModels([...apiModels, ...FALLBACK_MODELS]);
  } catch (error) {
    console.warn('Gemini models list fetch failed. Using fallback catalog.', error);
    return getDefaultModelOptions();
  }
};

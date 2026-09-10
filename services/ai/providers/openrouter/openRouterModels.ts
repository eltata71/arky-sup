/**
 * Model catalog for the OpenRouter provider.
 *
 * Used by the Settings UI to let the user pick a model. The provider itself
 * resolves its own default model via `resolveModel` (see OpenRouterProvider);
 * this module only supplies the catalog of selectable models plus a static
 * fallback that keeps the UI functional when no key is set or the remote
 * listing fails.
 */

/**
 * Tier -> model mapping. All tiers currently default to `openrouter/auto`
 * (OpenRouter routes to the best model for the prompt). Kept as a single
 * source of truth in case tier-specific models are wired later.
 */
export const OPENROUTER_MODEL_TIERS = {
  quick: 'openrouter/auto',
  default: 'openrouter/auto',
  deep: 'openrouter/auto',
} as const;

export type OpenRouterModelTier = keyof typeof OPENROUTER_MODEL_TIERS;

/** Shape mirrors `GeminiModelOption` from services/geminiModels.ts. */
export interface OpenRouterModelOption {
  id: string;
  name: string;
  description: string;
  source: 'api' | 'fallback';
}

interface OpenRouterModelApiItem {
  id?: string;
  /** OpenRouter API field; `name` is the canonical display label. */
  displayName?: string;
  name?: string;
  description?: string;
}

interface OpenRouterModelsApiResponse {
  data?: OpenRouterModelApiItem[];
}

export const OPENROUTER_FALLBACK_MODELS: OpenRouterModelOption[] = [
  {
    id: 'openrouter/auto',
    name: 'OpenRouter Auto (Predeterminado)',
    description: 'Routing inteligente: elige el mejor modelo para cada petición.',
    source: 'fallback',
  },
  {
    id: 'openai/gpt-5',
    name: 'OpenAI GPT-5',
    description: 'Modelo generalista de OpenAI con razonamiento avanzado.',
    source: 'fallback',
  },
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Anthropic Claude 3.5 Sonnet',
    description: 'Modelo equilibrado de Anthropic, sólido en texto y razonamiento.',
    source: 'fallback',
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek Chat',
    description: 'Modelo eficiente de DeepSeek para tareas cotidianas de bajo costo.',
    source: 'fallback',
  },
  {
    id: 'meta-llama/llama-3.3-70b-instruct',
    name: 'Meta Llama 3.3 70B Instruct',
    description: 'Modelo open-weight de Meta, capaz y flexible.',
    source: 'fallback',
  },
  {
    id: 'mistralai/mistral-small',
    name: 'Mistral Small',
    description: 'Modelo compacto y rápido de Mistral AI.',
    source: 'fallback',
  },
];

const dedupeModels = (models: OpenRouterModelOption[]): OpenRouterModelOption[] => {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
};

const buildLabel = (item: OpenRouterModelApiItem, id: string): string => {
  const label = item.displayName || item.name || '';
  if (label.trim().length > 0) {
    return label.trim();
  }
  return id;
};

const mapApiData = (items: OpenRouterModelApiItem[]): OpenRouterModelOption[] =>
  items
    .filter((item) => {
      const id = (item.id || '').trim();
      return id.length > 0;
    })
    .map((item) => {
      const id = (item.id || '').trim();
      return {
        id,
        name: buildLabel(item, id),
        description: (item.description || '').trim(),
        source: 'api' as const,
      };
    });

/**
 * List the current OpenRouter models, falling back to a static catalog when no
 * key is provided, the response is empty, or the remote call fails.
 */
export const listCurrentOpenRouterModels = async (apiKey: string): Promise<OpenRouterModelOption[]> => {
  const key = (apiKey || '').trim();
  if (!key) {
    return OPENROUTER_FALLBACK_MODELS;
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      throw new Error(`OpenRouter model listing failed with status ${response.status}`);
    }

    const data = (await response.json()) as OpenRouterModelsApiResponse;
    const apiModels = mapApiData(data.data || []);

    if (apiModels.length === 0) {
      return OPENROUTER_FALLBACK_MODELS;
    }

    // Union, fallbacks first so the defaults always remain present.
    return dedupeModels([...OPENROUTER_FALLBACK_MODELS, ...apiModels]);
  } catch (error) {
    console.warn('OpenRouter models list fetch failed. Using fallback catalog.', error);
    return OPENROUTER_FALLBACK_MODELS;
  }
};

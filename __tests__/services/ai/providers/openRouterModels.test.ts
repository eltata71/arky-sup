import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listCurrentOpenRouterModels,
  OPENROUTER_FALLBACK_MODELS,
  OPENROUTER_MODEL_TIERS,
  type OpenRouterModelOption,
} from '../../../../services/ai/providers/openrouter/openRouterModels';

describe('openRouterModels catalog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exposes a tier mapping (all tiers default to openrouter/auto)', () => {
    expect(OPENROUTER_MODEL_TIERS).toEqual({
      quick: 'openrouter/auto',
      default: 'openrouter/auto',
      deep: 'openrouter/auto',
    });
  });

  it('fallback catalog contains the required known models', () => {
    const ids = OPENROUTER_FALLBACK_MODELS.map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'openrouter/auto',
        'openai/gpt-5',
        'anthropic/claude-3.5-sonnet',
        'deepseek/deepseek-chat',
        'meta-llama/llama-3.3-70b-instruct',
        'mistralai/mistral-small',
      ]),
    );
    for (const model of OPENROUTER_FALLBACK_MODELS) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.description).toBeTruthy();
      expect(model.source).toBe('fallback');
    }
  });

  it('returns OPENROUTER_FALLBACK_MODELS when no apiKey is provided', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const result = await listCurrentOpenRouterModels('');
    expect(result).toEqual(OPENROUTER_FALLBACK_MODELS);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps api data and keeps fallbacks present (dedupe union, fallbacks first)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'openrouter/auto', displayName: 'Auto Router', description: 'APIs auto' },
          { id: 'anthropic/claude-4-sonnet', displayName: 'Claude 4 Sonnet', description: 'Nuevo modelo Anthropic' },
          { id: 'some/custom-model', description: 'Solo descriptivo' },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listCurrentOpenRouterModels('test-key');

    // api items are present, missing displayName falls back to id
    const byId = new Map(result.map((m) => [m.id, m]));
    expect(byId.get('some/custom-model')).toMatchObject({ name: 'some/custom-model', source: 'api' });
    // an api-only model maps its displayName
    expect(byId.get('anthropic/claude-4-sonnet')).toMatchObject({ name: 'Claude 4 Sonnet', source: 'api' });
    // an id shared with the fallback keeps the fallback entry (fallbacks win the union)
    expect(byId.get('openrouter/auto')).toMatchObject({ source: 'fallback' });

    // fallbacks are always present even if the api did not return them
    for (const model of OPENROUTER_FALLBACK_MODELS) {
      expect(byId.has(model.id)).toBe(true);
    }

    // fallbacks come first, then api-only models
    const resultIds = result.map((m) => m.id);
    expect(resultIds.indexOf('openrouter/auto')).toBeLessThan(resultIds.indexOf('some/custom-model'));

    // no duplicate ids
    expect(new Set(resultIds).size).toBe(resultIds.length);
  });

  it('sends the Authorization Bearer header and hits the /models endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await listCurrentOpenRouterModels('secret-key');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    expect(init.headers).toEqual({ Authorization: 'Bearer secret-key' });
  });

  it('dropped models (empty id) are filtered out', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: '', name: 'vacío' }, { id: '   ', name: 'espacio' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listCurrentOpenRouterModels('test-key');
    expect(result.some((m) => m.id.trim() === '')).toBe(false);
  });

  it('returns OPENROUTER_FALLBACK_MODELS when fetch rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await listCurrentOpenRouterModels('test-key');
    expect(result).toEqual(OPENROUTER_FALLBACK_MODELS);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('returns OPENROUTER_FALLBACK_MODELS when the response is not ok', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await listCurrentOpenRouterModels('bad-key');
    expect(result).toEqual(OPENROUTER_FALLBACK_MODELS);
  });

  it('compiles to the documented OpenRouterModelOption shape', () => {
    const sample: OpenRouterModelOption = {
      id: 'openrouter/auto',
      name: 'Auto',
      description: 'Desc',
      source: 'fallback',
    };
    expect(sample.source === 'fallback' || sample.source === 'api').toBe(true);
  });
});

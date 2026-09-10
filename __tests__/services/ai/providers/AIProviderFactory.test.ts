import { describe, expect, it } from 'vitest';
import { AIProviderFactory } from '../../../../services/ai/providers/AIProviderFactory';
import { OpenRouterProvider } from '../../../../services/ai/providers/openrouter/OpenRouterProvider';
import { AIError } from '../../../../services/ai/core/AIError';
import { NO_CAPABILITIES } from '../../../../services/ai/core/AICapabilities';
import type { AIProvider } from '../../../../services/ai/core/AIProvider';
import type { AIProviderId } from '../../../../services/ai/core/AIModel';
import type { AIRequest } from '../../../../services/ai/core/AIRequest';
import type { AIResponse } from '../../../../services/ai/core/AIResponse';
import type { AITextStream } from '../../../../services/ai/core/AIStream';
import type { Settings } from '../../../../types';

const settings: Settings = {
  theme: 'dark',
  language: 'es',
  globalContext: [],
  aiConfig: {
    model: '',
    temperature: 0.7,
    tone: 'Profesional y Técnico',
    languageStyle: 'Conciso y directo',
    apiKeySource: 'global',
  },
};

class TextOnlyProvider implements AIProvider {
  readonly id = 'mock' as AIProviderId;
  readonly name = 'Text-only Mock';
  readonly capabilities = { ...NO_CAPABILITIES };
  async generateText(): Promise<AIResponse> {
    throw new AIError({
      category: 'unknown',
      provider: this.id,
      message: 'not implemented',
      userMessage: 'not implemented',
      retryable: false,
    });
  }
  generateStructured<T = unknown>(): Promise<AIResponse<T>> {
    return this.generateText() as Promise<AIResponse<T>>;
  }
  async streamText(_request: AIRequest): Promise<AITextStream> {
    return (async function* () {})();
  }
  classifyError(error: unknown): AIError {
    return error instanceof AIError
      ? error
      : new AIError({
          category: 'unknown',
          provider: this.id,
          message: String(error),
          userMessage: 'mock',
          retryable: false,
        });
  }
  estimateUsage(response: AIResponse) {
    return response.usage;
  }
}

describe('AIProviderFactory', () => {
  it('registers Gemini by default', () => {
    const factory = new AIProviderFactory();
    expect(factory.has('gemini')).toBe(true);
    expect(factory.list()).toContain('gemini');
  });

  it('builds the default provider via create()', () => {
    const factory = new AIProviderFactory();
    const provider = factory.create({ settings });
    expect(provider.id).toBe('gemini');
    expect(provider.name).toBe('Google Gemini');
  });

  it('throws when asked for an unregistered provider', () => {
    const factory = new AIProviderFactory();
    expect(() => factory.create({ settings, provider: 'openai' })).toThrowError(/openai/);
  });

  it('lets a new provider be registered without touching call sites', () => {
    const factory = new AIProviderFactory();
    factory.register('mock', () => new TextOnlyProvider());
    expect(factory.has('mock')).toBe(true);
    expect(factory.create({ settings, provider: 'mock' }).id).toBe('mock');
  });

  it('selects a provider by capability, preferring the requested order', () => {
    const factory = new AIProviderFactory();
    const provider = factory.createForCapability({ settings, capability: 'streaming' });
    expect(provider.id).toBe('gemini');
  });

  /**
   * `embeddings` used to be a member of the factory's capability union with no
   * method on `AIProvider` behind it, so this call could only ever throw. The
   * capability is gone rather than stubbed: the assertion that replaces it is
   * that a capability *no shipped adapter serves* still fails honestly.
   */
  it('throws when no registered provider supports a capability', () => {
    const factory = new AIProviderFactory();
    factory.register('mock', () => new TextOnlyProvider());
    const bare = new AIProviderFactory();
    bare.register('gemini', () => new TextOnlyProvider());
    bare.register('openrouter', () => new TextOnlyProvider());
    bare.register('anthropic', () => new TextOnlyProvider());
    expect(() =>
      bare.createForCapability({ settings, capability: 'audio' }),
    ).toThrowError(/no registered provider supports/);
  });

  it('reports what every registered backend can do, for the router', () => {
    const factory = new AIProviderFactory();
    const map = factory.capabilityMap(settings);
    expect(map.get('gemini')?.tools).toBe(true);
    expect(map.get('anthropic')?.images).toBe(false);
    expect([...map.keys()].sort()).toEqual(['anthropic', 'gemini', 'openrouter']);
  });
});

describe('AIProviderFactory · openrouter', () => {
  it('registers openrouter (has/list)', () => {
    const f = new AIProviderFactory();
    expect(f.has('openrouter')).toBe(true);
    expect(f.list()).toContain('openrouter');
  });

  it('creates an OpenRouterProvider via create({ provider: "openrouter" })', () => {
    const f = new AIProviderFactory();
    const p = f.create({ settings, provider: 'openrouter' });
    expect(p).toBeInstanceOf(OpenRouterProvider);
    expect(p.id).toBe('openrouter');
  });

  it('uses openrouter as the default provider when configured', () => {
    const f = new AIProviderFactory({ defaultProvider: 'openrouter' });
    const p = f.create({ settings });
    expect(p).toBeInstanceOf(OpenRouterProvider);
    expect(p.id).toBe('openrouter');
  });
});

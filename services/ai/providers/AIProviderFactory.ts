/**
 * AIProviderFactory — the single seam for choosing an `AIProvider`.
 *
 * Gemini, OpenRouter and Anthropic are registered. Adding another means
 * registering a builder under its id; every call site already programs against
 * the `AIProvider` interface, so nothing downstream changes — Anthropic was
 * added exactly that way, as the plan's acceptance test.
 */

import type { Settings } from '../../../types';
import {
  providerSupports,
  type AICapabilityName,
  type AIProviderCapabilities,
} from '../core/AICapabilities';
import type { AIProviderId } from '../core/AIModel';
import type { AIProvider } from '../core/AIProvider';
import { GeminiProvider } from './gemini/GeminiProvider';
import { OpenRouterProvider } from './openrouter/OpenRouterProvider';
import { AnthropicProvider } from './anthropic/AnthropicProvider';

export type AIProviderBuilder = (input: { settings: Settings }) => AIProvider;

/**
 * Logical capability used to pick a provider without hard-coding ids.
 *
 * An alias for the canonical `AICapabilityName`, not a second list. The
 * previous local union carried `embeddings` — a capability `AIProvider` had no
 * method for, that `supportsCapability` could only answer `false` to, and that
 * therefore made `createForCapability({ capability: 'embeddings' })` an
 * expensive way to throw. One vocabulary means a capability cannot be published
 * here without an adapter that answers it.
 */
export type AIProviderCapability = AICapabilityName;

export interface AIProviderFactoryOptions {
  /** Provider id used when the caller does not request a specific one. */
  defaultProvider?: AIProviderId;
}

export class AIProviderFactory {
  private readonly registry = new Map<AIProviderId, AIProviderBuilder>();
  private readonly defaultProvider: AIProviderId;

  constructor(options: AIProviderFactoryOptions = {}) {
    this.defaultProvider = options.defaultProvider ?? 'gemini';
    this.register('gemini', ({ settings }) => new GeminiProvider({ settings }));
    this.register('openrouter', ({ settings }) => new OpenRouterProvider({ settings }));
    this.register('anthropic', ({ settings }) => new AnthropicProvider({ settings }));
  }

  /** Register (or replace) a provider builder. */
  register(id: AIProviderId, builder: AIProviderBuilder): void {
    this.registry.set(id, builder);
  }

  /** True when a builder is registered for `id`. */
  has(id: AIProviderId): boolean {
    return this.registry.has(id);
  }

  /** All registered provider ids. */
  list(): AIProviderId[] {
    return Array.from(this.registry.keys());
  }

  /** Build the requested provider (or the default when omitted). */
  create(input: { settings: Settings; provider?: AIProviderId }): AIProvider {
    const id = input.provider ?? this.defaultProvider;
    const builder = this.registry.get(id);
    if (!builder) {
      throw new Error(`AIProviderFactory: no implementation registered for provider "${id}".`);
    }
    return builder({ settings: input.settings });
  }

  /**
   * What every registered backend can do, for these settings.
   *
   * This is the input the routing engine needs and the reason it does not have
   * to construct providers itself: building one is cheap (each constructor
   * stores `settings` and nothing else) but *knowing* that is a fact about the
   * adapters, and a planner that depends on it is a planner that breaks the day
   * an adapter opens a connection in its constructor.
   */
  capabilityMap(settings: Settings): ReadonlyMap<AIProviderId, AIProviderCapabilities> {
    const map = new Map<AIProviderId, AIProviderCapabilities>();
    for (const id of this.list()) {
      const builder = this.registry.get(id);
      if (!builder) continue;
      try {
        map.set(id, builder({ settings }).capabilities);
      } catch {
        // A backend that cannot even be constructed cannot serve anything;
        // leaving it out of the map is the same statement the planner would
        // otherwise have to make from an exception.
      }
    }
    return map;
  }

  /** Build the first registered provider that supports `capability`. */
  createForCapability(input: {
    settings: Settings;
    capability: AIProviderCapability;
    preferred?: AIProviderId[];
  }): AIProvider {
    const order = input.preferred && input.preferred.length > 0
      ? [...input.preferred, ...this.list()]
      : [this.defaultProvider, ...this.list()];
    const seen = new Set<AIProviderId>();
    for (const id of order) {
      if (seen.has(id)) continue;
      seen.add(id);
      const builder = this.registry.get(id);
      if (!builder) continue;
      const provider = builder({ settings: input.settings });
      if (providerSupports(provider.capabilities, input.capability)) return provider;
    }
    throw new Error(
      `AIProviderFactory: no registered provider supports capability "${input.capability}".`,
    );
  }
}

/** Shared factory instance. */
export const aiProviderFactory = new AIProviderFactory();

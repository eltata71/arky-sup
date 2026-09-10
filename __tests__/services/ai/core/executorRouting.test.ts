/**
 * The executor's three new obligations, each pinned to the defect it closes.
 *
 *  1. **Classification is the provider's.** `AIRequestExecutor` took an
 *     `AIErrorClassifier` in its constructor and defaulted it to
 *     `geminiErrorClassifier`, so every failure from every backend was stamped
 *     `provider: 'gemini'` and judged by Google's heuristics — on the path
 *     documented as provider-driven. `AIProvider.classifyError` existed and was
 *     called by nobody.
 *  2. **A required capability reroutes.** Negotiation reported gaps and never
 *     blocked, so a policy demanding structured output ran anyway against a
 *     backend that cannot enforce a schema.
 *  3. **Model fallback and provider fallback are separate.** Falling to another
 *     vendor changes who processes the data and is gated by its own policy
 *     flag, not by the one that enables retries.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIRequestExecutor } from '../../../../services/ai/core/AIRequestExecutor';
import { AIError } from '../../../../services/ai/core/AIError';
import { resolvePolicy } from '../../../../services/ai/core/AIPolicy';
import { NO_CAPABILITIES, type AIProviderCapabilities } from '../../../../services/ai/core/AICapabilities';
import type { AIProvider } from '../../../../services/ai/core/AIProvider';
import type { AIProviderId } from '../../../../services/ai/core/AIModel';
import type { AIRequest } from '../../../../services/ai/core/AIRequest';
import type { AIResponse } from '../../../../services/ai/core/AIResponse';
import type { AITextStream } from '../../../../services/ai/core/AIStream';
import type { AIToolDefinition } from '../../../../services/ai/core/AITool';
import type { AIRoutePlan, AIRouteCandidate } from '../../../../services/ai/routing/routeTypes';
import {
  providerHealthSnapshot,
  resetProviderHealth,
} from '../../../../services/ai/routing/providerHealth';
import { observabilityService } from '../../../../services/observability';

const FULL: AIProviderCapabilities = {
  streaming: true,
  structuredOutput: true,
  tools: true,
  images: true,
  files: true,
  audio: true,
};

const trace = () =>
  ({
    requestId: 'stub',
    purpose: 'stub',
    provider: 'gemini' as AIProviderId,
    providerRequested: 'gemini' as AIProviderId,
    fallbackProviderUsed: false,
    modelRequested: 'stub',
    modelEffective: 'stub',
    modelSource: 'global' as const,
    fallbackModelUsed: false,
    tier: 'default' as const,
    mode: 'balanced' as const,
    retryCount: 0,
    timeoutMs: 0,
    durationMs: 1,
    structuredOutput: false,
    streaming: false,
    status: 'success' as const,
    localFallbackUsed: false,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  });

class FakeProvider implements AIProvider {
  readonly name = 'Fake';
  readonly calls: string[] = [];
  constructor(
    readonly id: AIProviderId,
    readonly capabilities: AIProviderCapabilities,
    private readonly behaviour: (request: AIRequest) => Promise<AIResponse>,
    /** The category this adapter reports for any raw failure. */
    private readonly category: AIError['category'] = 'overloaded',
  ) {}
  async generateText(request: AIRequest): Promise<AIResponse> {
    this.calls.push(`${this.id}:${request.model}`);
    return this.behaviour(request);
  }
  generateStructured<T = unknown>(request: AIRequest): Promise<AIResponse<T>> {
    return this.generateText(request) as Promise<AIResponse<T>>;
  }
  async streamText(): Promise<AITextStream> {
    return (async function* () {
      yield { text: 'x' };
    })() as unknown as AITextStream;
  }
  classifyError(error: unknown): AIError {
    if (AIError.is(error)) return error;
    return new AIError({
      category: this.category,
      provider: this.id,
      message: String(error),
      userMessage: 'fake',
      retryable: this.category !== 'invalid-request',
    });
  }
  estimateUsage(response: AIResponse) {
    return response.usage;
  }
}

const ok = (text: string): AIResponse => ({ text, usage: { durationMs: 1 }, trace: trace() });

const request = (over: Partial<AIRequest> = {}): AIRequest => ({
  purpose: 'test',
  prompt: 'hola',
  ...over,
});

const candidate = (
  provider: AIProviderId,
  model: string,
  capabilities = FULL,
): AIRouteCandidate => ({ provider, model, tier: 'default', source: 'global', capabilities });

const plan = (attempts: AIRouteCandidate[]): AIRoutePlan => ({
  primary: attempts[0],
  fallbacks: attempts.slice(1),
  decision: { required: [], considered: [], rejected: [], reroutedForCapability: false },
});

const TOOL: AIToolDefinition = {
  name: 'modifyArtifact',
  description: 'edita',
  parameters: { type: 'object', properties: { target: { type: 'string' } } },
};

const executor = new AIRequestExecutor();
const noRetry = (over = {}) => resolvePolicy('balanced', { maxRetries: 0, ...over });

beforeEach(() => {
  resetProviderHealth();
  vi.spyOn(observabilityService, 'recordWarning').mockReturnValue({} as never);
});

describe('classification is the provider’s', () => {
  it('stamps the failing backend, not Gemini', async () => {
    const anthropic = new FakeProvider('anthropic', FULL, async () => {
      throw new Error('boom');
    });
    await expect(
      executor.execute(anthropic, request(), noRetry({ allowModelFallback: false })),
    ).rejects.toMatchObject({ provider: 'anthropic' });
  });

  it('lets the adapter decide whether a failure is worth retrying', async () => {
    let attempts = 0;
    const provider = new FakeProvider(
      'openrouter',
      FULL,
      async () => {
        attempts += 1;
        throw new Error('nope');
      },
      // The adapter calls it a bad request, so nothing should be retried.
      'invalid-request',
    );
    await expect(
      executor.execute(provider, request(), resolvePolicy('balanced', { allowModelFallback: false })),
    ).rejects.toMatchObject({ category: 'invalid-request' });
    expect(attempts).toBe(1);
  });
});

describe('required capabilities gate the attempt', () => {
  it('refuses rather than running a schema-required request on a backend that cannot enforce one', async () => {
    const weak = new FakeProvider('openrouter', { ...NO_CAPABILITIES, streaming: true }, async () =>
      ok('should not be reached'),
    );
    await expect(
      executor.execute(
        weak,
        request({ responseSchema: { type: 'object' } }),
        noRetry({ structuredOutput: 'required', allowModelFallback: false }),
      ),
    ).rejects.toMatchObject({ errorCode: 'required_capability_unavailable' });
    expect(weak.calls).toEqual([]);
  });

  it('skips a candidate that cannot call tools and uses the one that can', async () => {
    const weak = new FakeProvider('openrouter', { ...FULL, tools: false }, async () => ok('weak'));
    const strong = new FakeProvider('anthropic', FULL, async () => ok('strong'));
    const response = await executor.execute(weak, request({ tools: [TOOL] }), noRetry(), {
      routePlan: plan([candidate('openrouter', 'm1', weak.capabilities), candidate('anthropic', 'm2')]),
      resolveProvider: () => strong,
    });
    expect(response.text).toBe('strong');
    expect(weak.calls).toEqual([]);
  });

  it('spends no tokens before refusing — the gate runs first', async () => {
    const weak = new FakeProvider('openrouter', { ...FULL, tools: false }, async () => ok('x'));
    await expect(
      executor.execute(weak, request({ tools: [TOOL] }), noRetry({ allowModelFallback: false })),
    ).rejects.toBeInstanceOf(AIError);
    expect(weak.calls).toEqual([]);
  });
});

describe('model fallback and provider fallback are independent', () => {
  it('walks the model chain inside one backend without touching another', async () => {
    const gemini = new FakeProvider('gemini', FULL, async (r) => {
      if (r.model === 'm1') throw new Error('overloaded');
      return ok(`served:${r.model}`);
    });
    const other = new FakeProvider('anthropic', FULL, async () => ok('other'));
    const response = await executor.execute(gemini, request(), noRetry(), {
      routePlan: plan([candidate('gemini', 'm1'), candidate('gemini', 'm2')]),
      resolveProvider: () => other,
    });
    expect(response.text).toBe('served:m2');
    expect(other.calls).toEqual([]);
  });

  it('does not cross to another backend when the policy forbids it', async () => {
    const gemini = new FakeProvider('gemini', FULL, async () => {
      throw new Error('overloaded');
    });
    const anthropic = new FakeProvider('anthropic', FULL, async () => ok('rescued'));
    await expect(
      executor.execute(gemini, request(), noRetry({ allowProviderFallback: false }), {
        routePlan: plan([candidate('gemini', 'm1'), candidate('anthropic', 'm2')]),
        resolveProvider: () => anthropic,
      }),
    ).rejects.toBeInstanceOf(AIError);
    expect(anthropic.calls).toEqual([]);
  });

  it('crosses to another backend when the policy allows it, and records it in the trace', async () => {
    const gemini = new FakeProvider('gemini', FULL, async () => {
      throw new Error('overloaded');
    });
    const anthropic = new FakeProvider('anthropic', FULL, async () => ok('rescued'));
    const response = await executor.execute(
      gemini,
      request(),
      noRetry({ allowProviderFallback: true }),
      {
        routePlan: plan([candidate('gemini', 'm1'), candidate('anthropic', 'm2')]),
        resolveProvider: () => anthropic,
      },
    );
    expect(response.text).toBe('rescued');
    expect(response.trace.fallbackProviderUsed).toBe(true);
    expect(response.trace.provider).toBe('anthropic');
    expect(response.trace.providerRequested).toBe('gemini');
  });

  /**
   * A malformed request is malformed everywhere. Paying a second vendor to
   * receive the same 400 is not resilience.
   */
  it('does not cross backends for a request the first one called invalid', async () => {
    const gemini = new FakeProvider(
      'gemini',
      FULL,
      async () => {
        throw new Error('bad');
      },
      'invalid-request',
    );
    const anthropic = new FakeProvider('anthropic', FULL, async () => ok('rescued'));
    await expect(
      executor.execute(gemini, request(), noRetry({ allowProviderFallback: true, allowModelFallback: false }), {
        routePlan: plan([candidate('gemini', 'm1'), candidate('anthropic', 'm2')]),
        resolveProvider: () => anthropic,
      }),
    ).rejects.toMatchObject({ category: 'invalid-request' });
    expect(anthropic.calls).toEqual([]);
  });
});

describe('health is recorded from real outcomes only', () => {
  it('counts a transport failure against the backend', async () => {
    const provider = new FakeProvider('anthropic', FULL, async () => {
      throw new Error('down');
    });
    await expect(
      executor.execute(provider, request(), noRetry({ allowModelFallback: false })),
    ).rejects.toBeInstanceOf(AIError);
    expect(providerHealthSnapshot('anthropic').failures).toBe(1);
  });

  /**
   * Our own mistakes must not open a circuit against a vendor: a 400 we
   * produced is a fact about this repository, not about their availability.
   */
  it('does not count a request we malformed', async () => {
    const provider = new FakeProvider(
      'anthropic',
      FULL,
      async () => {
        throw new Error('bad');
      },
      'invalid-request',
    );
    await expect(
      executor.execute(provider, request(), noRetry({ allowModelFallback: false })),
    ).rejects.toBeInstanceOf(AIError);
    expect(providerHealthSnapshot('anthropic').failures).toBe(0);
  });

  it('clears the streak on a success', async () => {
    const provider = new FakeProvider('anthropic', FULL, async () => ok('fine'));
    await executor.execute(provider, request(), noRetry());
    expect(providerHealthSnapshot('anthropic').successes).toBe(1);
  });
});

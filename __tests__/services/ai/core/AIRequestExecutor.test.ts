import { describe, expect, it, vi } from 'vitest';
import { AIRequestExecutor } from '../../../../services/ai/core/AIRequestExecutor';
import { AIRetryPolicy } from '../../../../services/ai/retry/AIRetryPolicy';
import { AIError } from '../../../../services/ai/core/AIError';
import { AIErrorClassifier } from '../../../../services/ai/errors/AIErrorClassifier';
import { resolvePolicy } from '../../../../services/ai/core/AIPolicy';
import { collectStream, toAITextStream } from '../../../../services/ai/core/AIStream';
import type { AIProvider } from '../../../../services/ai/core/AIProvider';
import type { AIRequest } from '../../../../services/ai/core/AIRequest';
import type { AIResponse } from '../../../../services/ai/core/AIResponse';
import type { AITextStream } from '../../../../services/ai/core/AIStream';
import type { AITrace } from '../../../../services/ai/core/AITrace';

const instantSleep = async (): Promise<void> => {};

const mockClassifier = new AIErrorClassifier('mock' as AIProvider['id']);

const fakeTrace = (): AITrace => ({
  requestId: 'stub',
  purpose: 'stub',
  provider: 'mock',
  providerRequested: 'mock',
  fallbackProviderUsed: false,
  modelRequested: 'stub',
  modelEffective: 'stub',
  modelSource: 'global',
  fallbackModelUsed: false,
  tier: 'default',
  mode: 'balanced',
  retryCount: 0,
  timeoutMs: 0,
  durationMs: 1,
  structuredOutput: false,
  streaming: false,
  status: 'success',
  localFallbackUsed: false,
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
});

const makeResponse = (text: string, structured?: unknown): AIResponse => ({
  text,
  structured,
  usage: { durationMs: 1 },
  trace: fakeTrace(),
});

type ProviderBehavior = {
  generateText?: (request: AIRequest) => Promise<AIResponse>;
  generateStructured?: (request: AIRequest, schema?: unknown) => Promise<AIResponse>;
  streamText?: (request: AIRequest) => Promise<AITextStream>;
};

class MockProvider implements AIProvider {
  readonly id = 'mock' as AIProvider['id'];
  readonly name = 'Mock';
  readonly capabilities = {
    streaming: true,
    structuredOutput: true,
    tools: true,
    images: false,
    files: false,
    audio: false,
  };
  constructor(private readonly behavior: ProviderBehavior) {}
  generateText(request: AIRequest): Promise<AIResponse> {
    return (this.behavior.generateText ?? (async () => makeResponse('default')))(request);
  }
  async generateStructured<T = unknown>(
    request: AIRequest,
    schema?: unknown,
  ): Promise<AIResponse<T>> {
    const impl = this.behavior.generateStructured ?? (async () => makeResponse('{}', {}));
    return (await impl(request, schema)) as AIResponse<T>;
  }
  streamText(request: AIRequest): Promise<AITextStream> {
    return (this.behavior.streamText ??
      (async () => toAITextStream((async function* () {})())))(request);
  }
  /**
   * Classification is the adapter's job now, so the mock has to do the adapter's
   * job. It delegates to the shared `AIErrorClassifier` exactly as all three
   * shipped providers do — a stub that answered `unknown` to everything would be
   * testing a backend no adapter in this repository resembles, and would make
   * model fallback look broken when what is broken is the stub.
   */
  classifyError(error: unknown): AIError {
    return mockClassifier.classify(error);
  }
  estimateUsage(response: AIResponse) {
    return response.usage;
  }
}

const baseRequest = (overrides: Partial<AIRequest> = {}): AIRequest => ({
  purpose: 'unit-test',
  prompt: 'Generate something useful.',
  mode: 'balanced',
  ...overrides,
});

describe('AIRequestExecutor.runWithModelFallback', () => {
  const executor = new AIRequestExecutor();

  it('returns the first model result on success', async () => {
    const attempt = vi.fn(async (model: string) => `from:${model}`);
    const result = await executor.runWithModelFallback<string>({
      preferredModel: 'gemini-2.5-flash',
      fallbackChain: ['gemini-2.5-pro'],
      attempt,
      retryPolicy: new AIRetryPolicy({ maxRetries: 2, sleep: instantSleep }),
      timeoutMs: 5000,
      shouldRetry: () => true,
      normalizeError: (e) => (e instanceof Error ? e : new Error(String(e))),
      isModelFallbackCandidate: () => true,
    });
    expect(result).toBe('from:gemini-2.5-flash');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('retries a transient failure on the same model', async () => {
    let calls = 0;
    const result = await executor.runWithModelFallback<string>({
      preferredModel: 'gemini-2.5-flash',
      fallbackChain: [],
      attempt: async () => {
        calls += 1;
        if (calls < 2) throw new Error('overloaded');
        return 'ok';
      },
      retryPolicy: new AIRetryPolicy({ maxRetries: 3, sleep: instantSleep }),
      timeoutMs: 5000,
      shouldRetry: () => true,
      normalizeError: (e) => (e instanceof Error ? e : new Error(String(e))),
      isModelFallbackCandidate: () => false,
    });
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });

  it('falls through to the next model when the primary is a fallback candidate', async () => {
    const seen: string[] = [];
    const result = await executor.runWithModelFallback<string>({
      preferredModel: 'gemini-2.5-flash',
      fallbackChain: ['gemini-2.5-pro'],
      attempt: async (model) => {
        seen.push(model);
        if (model === 'gemini-2.5-flash') throw new Error('model overloaded');
        return `served-by:${model}`;
      },
      retryPolicy: new AIRetryPolicy({ maxRetries: 0, sleep: instantSleep }),
      timeoutMs: 5000,
      shouldRetry: () => false,
      normalizeError: (e) => (e instanceof Error ? e : new Error(String(e))),
      isModelFallbackCandidate: () => true,
    });
    expect(result).toBe('served-by:gemini-2.5-pro');
    expect(seen).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
  });

  it('throws the normalized error when no model is a fallback candidate', async () => {
    await expect(
      executor.runWithModelFallback<string>({
        preferredModel: 'gemini-2.5-flash',
        fallbackChain: ['gemini-2.5-pro'],
        attempt: async () => {
          throw new Error('hard failure');
        },
        retryPolicy: new AIRetryPolicy({ maxRetries: 0, sleep: instantSleep }),
        timeoutMs: 5000,
        shouldRetry: () => false,
        normalizeError: () => new Error('normalized-failure'),
        isModelFallbackCandidate: () => false,
      }),
    ).rejects.toThrowError('normalized-failure');
  });

  it('aborts before any attempt when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const attempt = vi.fn(async () => 'never');
    await expect(
      executor.runWithModelFallback<string>({
        preferredModel: 'gemini-2.5-flash',
        fallbackChain: [],
        attempt,
        retryPolicy: new AIRetryPolicy({ maxRetries: 0, sleep: instantSleep }),
        timeoutMs: 5000,
        shouldRetry: () => false,
        normalizeError: (e) => (e instanceof Error ? e : new Error(String(e))),
        isModelFallbackCandidate: () => false,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(attempt).not.toHaveBeenCalled();
  });

  it('enforces a per-attempt timeout', async () => {
    await expect(
      executor.runWithModelFallback<string>({
        preferredModel: 'gemini-2.5-flash',
        fallbackChain: [],
        attempt: () => new Promise((resolve) => setTimeout(() => resolve('late'), 500)),
        retryPolicy: new AIRetryPolicy({ maxRetries: 0, sleep: instantSleep }),
        timeoutMs: 20,
        shouldRetry: () => false,
        normalizeError: (e) => (e instanceof Error ? e : new Error(String(e))),
        isModelFallbackCandidate: () => false,
      }),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
  });
});

describe('AIRequestExecutor.execute', () => {
  const executor = new AIRequestExecutor();

  it('returns a response with a fully populated trace on success', async () => {
    const provider = new MockProvider({
      generateText: async (request) => makeResponse(`served:${request.model}`),
    });
    const response = await executor.execute(provider, baseRequest());
    expect(response.text).toBe('served:gemini-2.5-flash');
    expect(response.trace.status).toBe('success');
    expect(response.trace.provider).toBe('mock');
    expect(response.trace.mode).toBe('balanced');
    expect(response.trace.tier).toBe('default');
    expect(response.trace.streaming).toBe(false);
  });

  it('falls through to the next model and records it in the trace', async () => {
    const provider = new MockProvider({
      generateText: async (request) => {
        if (request.model === 'gemini-2.5-flash') {
          throw { status: 400, message: 'invalid model' };
        }
        return makeResponse(`served:${request.model}`);
      },
    });
    const response = await executor.execute(provider, baseRequest());
    expect(response.text).toBe('served:gemini-2.5-pro');
    expect(response.trace.fallbackModelUsed).toBe(true);
    expect(response.trace.modelEffective).toBe('gemini-2.5-pro');
  });

  it('rejects an empty response with an empty-response AIError', async () => {
    const provider = new MockProvider({ generateText: async () => makeResponse('') });
    await expect(
      executor.execute(
        provider,
        baseRequest(),
        resolvePolicy('balanced', { maxRetries: 0, allowModelFallback: false }),
      ),
    ).rejects.toMatchObject({ category: 'empty-response' });
  });

  it('rejects an oversized prompt with an invalid-request AIError', async () => {
    const provider = new MockProvider({});
    await expect(
      executor.execute(
        provider,
        baseRequest({ prompt: 'x'.repeat(500) }),
        resolvePolicy('balanced', { maxPromptChars: 50 }),
      ),
    ).rejects.toMatchObject({ category: 'invalid-request', errorCode: 'prompt_too_large' });
  });

  it('produces structured output when responseFormat is json', async () => {
    const provider = new MockProvider({
      generateStructured: async () => makeResponse('{"score":7}', { score: 7 }),
    });
    const response = await executor.execute(
      provider,
      baseRequest({ responseFormat: 'json' }),
    );
    expect(response.structured).toEqual({ score: 7 });
    expect(response.trace.structuredOutput).toBe(true);
  });

  it('attaches a trace to the thrown AIError on terminal failure', async () => {
    const provider = new MockProvider({
      generateText: async () => {
        throw new AIError({
          category: 'auth',
          provider: 'mock',
          message: 'bad key',
          userMessage: 'Revisa la API key.',
          retryable: false,
        });
      },
    });
    await expect(executor.execute(provider, baseRequest())).rejects.toMatchObject({
      category: 'auth',
    });
  });
});

describe('AIRequestExecutor.executeStream', () => {
  const executor = new AIRequestExecutor();

  it('streams chunks through the provider', async () => {
    const provider = new MockProvider({
      streamText: async () =>
        toAITextStream(
          (async function* () {
            yield { text: 'Hola ' };
            yield { text: 'mundo' };
          })(),
        ),
    });
    const { stream, trace } = await executor.executeStream(provider, baseRequest());
    expect(await collectStream(stream)).toBe('Hola mundo');
    expect(trace.streaming).toBe(true);
    expect(trace.status).toBe('success');
  });
});

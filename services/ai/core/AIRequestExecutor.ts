/**
 * AIRequestExecutor — the single orchestration seam for AI generation.
 *
 * Responsibilities (the things a provider deliberately does NOT do):
 *   - walk the planned route, or this provider's own model chain;
 *   - refuse a candidate that cannot serve a **required** capability, before
 *     any tokens are spent;
 *   - apply per-attempt timeout (`AITimeoutPolicy`);
 *   - retry transient failures with backoff (`AIRetryPolicy`);
 *   - advance to the next model, or the next backend, on the categories that
 *     justify each;
 *   - record backend health so a degraded provider stops being ranked first;
 *   - build a full `AITrace` for every outcome (`AITraceBuilder`).
 *
 * What it deliberately does **not** do any more is classify. Classification is
 * `AIProvider.classifyError`'s job — the contract said so from the beginning
 * and nothing called it, because this class took an `AIErrorClassifier` in its
 * constructor and defaulted it to `geminiErrorClassifier`. Every failure from
 * every backend was stamped `provider: 'gemini'` and judged by heuristics
 * written for Google's SDK, on the path documented as provider-driven. The
 * decision that follows the classification is still shared and still lives
 * outside the adapters, in `errors/retryDecisions`.
 *
 * It exposes two surfaces:
 *   - `runWithModelFallback` — the legacy loop `geminiService` injects its own
 *     predicates into, kept in `modelFallbackLoop` while that façade migrates.
 *   - `execute` / `executeStream` — the canonical path.
 */

import type { Settings } from '../../../types';
import {
  isModelFallbackCandidate,
  isProviderFallbackCandidate,
  isRetryableError,
  reflectsProviderHealth,
} from '../errors/retryDecisions';
import { AIModelRouter, aiModelRouter } from '../modelRouting/AIModelRouter';
import { AIRetryPolicy } from '../retry/AIRetryPolicy';
import { AITimeoutPolicy } from '../retry/AITimeoutPolicy';
import { recordProviderFailure, recordProviderSuccess } from '../routing/providerHealth';
import type { AIRoutePlan, AIRouteCandidate } from '../routing/routeTypes';
import { planAttempts } from '../routing/routeTypes';
import { AITraceBuilder, newRequestId } from '../tracing/AITraceBuilder';
import { assertRequiredCapabilities, gapsFor, reportCapabilityGaps } from '../capabilities/negotiate';
import { AIError } from './AIError';
import { attachTrace, guardPromptSize, guardRequest, guardResponse } from './requestGuards';
import { runWithModelFallback, type RunWithModelFallbackOptions } from './modelFallbackLoop';
import type { AIPolicy } from './AIPolicy';
import { resolvePolicy } from './AIPolicy';
import type { AIProvider } from './AIProvider';
import type { AIRequest } from './AIRequest';
import { deriveRequiredCapabilities } from './AIRequest';
import type { AIResponse } from './AIResponse';
import { isEmptyResponse } from './AIResponse';
import type { AITextStream } from './AIStream';
import type { AIJsonSchema } from '../schema';
import type { AITrace } from './AITrace';

export interface ExecuteOptions {
  /** Settings carrier — supplies the user's preferred model to the router. */
  settings?: Settings;
  /** Provider-neutral JSON schema for structured output. */
  schema?: AIJsonSchema;
  /**
   * The route to walk, when the caller planned one.
   *
   * Absent means "this provider only": the executor stays on the instance it
   * was handed and falls through that provider's own model chain, which is
   * exactly what it did before planning existed. Planning is done by
   * `services/ai/routing`, which is above `core` and may build providers —
   * `core` must not, or the contract layer ends up depending on the adapters
   * it exists to hide.
   */
  routePlan?: AIRoutePlan;
  /**
   * How to obtain a provider instance for a candidate the plan names.
   *
   * Required for cross-provider fallback and absent by default, so a caller
   * that has not opted in cannot have its request served by a different vendor
   * through an option it did not pass.
   */
  resolveProvider?: (provider: AIRouteCandidate['provider']) => AIProvider;
}

export class AIRequestExecutor {
  constructor(private readonly router: AIModelRouter = aiModelRouter) {}

  /**
   * Generic retry + timeout + model-fallback loop, for the legacy façade.
   *
   * Delegates to `runWithModelFallback`; kept as a method because
   * `geminiService` calls it through the shared executor instance and moving
   * that import is a change to the legacy path, not to this one.
   */
  runWithModelFallback<T>(options: RunWithModelFallbackOptions<T>): Promise<T> {
    return runWithModelFallback(options);
  }

  /**
   * High-level provider-driven generation: routing + capability enforcement +
   * resilience + tracing.
   *
   * Three things changed here and each closes a hole the previous version had:
   *
   *  - Errors are classified by **the provider that produced them**, not by a
   *    Gemini-scoped classifier the constructor defaulted to. The retry and
   *    fallback decisions are then made from the canonical category, in
   *    `errors/retryDecisions`, so all three backends share one policy without
   *    sharing one vendor's heuristics.
   *  - A **required** capability the candidate cannot serve moves to the next
   *    candidate instead of running anyway with the guarantee removed.
   *  - Fallback walks a **route plan** when the caller supplied one, so model
   *    fallback and provider fallback are separate policies rather than one
   *    chain that happens to stay inside a vendor.
   */
  async execute(
    provider: AIProvider,
    request: AIRequest,
    policy: AIPolicy = resolvePolicy(request.mode),
    options: ExecuteOptions = {},
  ): Promise<AIResponse> {
    const mode = request.mode ?? policy.mode;
    const structuredOutput =
      request.responseFormat === 'json' || policy.structuredOutput === 'required';
    const attempts = this.attemptsFor(provider, request, policy, options);
    const requestId = request.requestId ?? newRequestId(request.purpose);
    const timeoutMs = request.timeoutMs ?? policy.timeoutMs;

    const trace = new AITraceBuilder({
      requestId,
      operationId: request.operationId,
      purpose: request.purpose,
      provider: attempts[0].provider,
      route: {
        id: attempts[0].model,
        tier: attempts[0].tier,
        source: attempts[0].source,
        requested: request.modelOverride,
        fallbackChain: attempts.slice(1).map((c) => c.model),
      },
      mode,
      timeoutMs,
      structuredOutput,
      streaming: false,
      contextPackId: request.contextPackId,
      routeDecision: options.routePlan?.decision,
    });

    guardPromptSize(request, policy, provider, trace);
    guardRequest(request, provider, trace);

    return this.runAttempts<AIResponse>({
      primary: provider,
      attempts,
      request,
      policy,
      options,
      timeoutMs,
      trace,
      requestId,
      streaming: false,
      structuredOutput,
      run: async (candidate, activeProvider, attemptRequest) => {
        const result = structuredOutput
          ? await activeProvider.generateStructured(
              attemptRequest,
              options.schema ?? request.responseSchema,
            )
          : await activeProvider.generateText(attemptRequest);
        if (isEmptyResponse(result)) {
          throw new AIError({
            category: 'empty-response',
            provider: candidate.provider,
            message: `Provider ${candidate.provider} returned an empty response for "${request.purpose}".`,
            userMessage: 'El modelo devolvió una respuesta vacía. Reintenta en unos segundos.',
            retryable: true,
            errorCode: 'empty_response',
          });
        }
        return result;
      },
      seal: (result) => {
        guardResponse(result.text, request, trace);
        return { ...result, trace: trace.success(result.usage) };
      },
    });
  }

  /**
   * High-level streaming generation. Stream-open errors fall through the plan;
   * once chunks flow we never retry (partial output is on screen).
   */
  async executeStream(
    provider: AIProvider,
    request: AIRequest,
    policy: AIPolicy = resolvePolicy(request.mode),
    options: ExecuteOptions = {},
  ): Promise<{ stream: AITextStream; trace: AITrace }> {
    const mode = request.mode ?? policy.mode;
    const attempts = this.attemptsFor(provider, request, policy, options).filter(
      (candidate) => candidate.capabilities.streaming,
    );
    if (attempts.length === 0) {
      throw new AIError({
        category: 'configuration',
        provider: provider.id,
        message: `No candidate backend for "${request.purpose}" supports streaming.`,
        userMessage: 'El proveedor de IA no admite streaming.',
        retryable: false,
        errorCode: 'streaming_unsupported',
      });
    }

    const requestId = request.requestId ?? newRequestId(request.purpose);
    const timeoutMs = request.timeoutMs ?? policy.timeoutMs;

    const trace = new AITraceBuilder({
      requestId,
      operationId: request.operationId,
      purpose: request.purpose,
      provider: attempts[0].provider,
      route: {
        id: attempts[0].model,
        tier: attempts[0].tier,
        source: attempts[0].source,
        requested: request.modelOverride,
        fallbackChain: attempts.slice(1).map((c) => c.model),
      },
      mode,
      timeoutMs,
      structuredOutput: false,
      streaming: true,
      contextPackId: request.contextPackId,
      routeDecision: options.routePlan?.decision,
    });

    guardPromptSize(request, policy, provider, trace);
    guardRequest(request, provider, trace);

    const stream = await this.runAttempts<AITextStream>({
      primary: provider,
      attempts,
      request,
      policy,
      options,
      timeoutMs,
      trace,
      requestId,
      streaming: true,
      structuredOutput: false,
      run: (_candidate, activeProvider, attemptRequest) => activeProvider.streamText(attemptRequest),
      seal: (result) => result,
    });
    return { stream, trace: trace.success() };
  }

  /**
   * The attempt sequence for one request.
   *
   * With a plan, the plan decides. Without one, the executor stays on the
   * provider it was handed and walks that provider's own model chain — the
   * behaviour every existing call site has today, preserved so that adding
   * planning did not change what an un-migrated caller does.
   */
  private attemptsFor(
    provider: AIProvider,
    request: AIRequest,
    policy: AIPolicy,
    options: ExecuteOptions,
  ): readonly AIRouteCandidate[] {
    if (options.routePlan) return planAttempts(options.routePlan);

    const route = this.router.route({
      mode: request.mode ?? policy.mode,
      tier: request.tier ?? policy.modelTier,
      modelOverride: request.modelOverride,
      settings: options.settings,
    });
    const primary: AIRouteCandidate = {
      provider: provider.id,
      model: route.id,
      tier: route.tier,
      source: route.source,
      capabilities: provider.capabilities,
    };
    if (!policy.allowModelFallback) return [primary];
    return [
      primary,
      ...route.fallbackChain.map((model) => ({ ...primary, model, source: 'fallback' as const })),
    ];
  }

  /**
   * Walk the attempt list: capability gate, timeout, retry, then advance.
   *
   * Advancing is two separate questions, asked in this order. Within one
   * backend a failure moves to the next model when the category says the model
   * is the problem. Across backends it moves to the next provider only when the
   * policy allows it *and* the category says the backend is the problem — a
   * malformed request is malformed everywhere, and paying a second vendor for
   * the same 400 is not resilience.
   */
  private async runAttempts<T>(input: {
    /** The provider instance the caller handed in — candidate zero's backend. */
    primary: AIProvider;
    attempts: readonly AIRouteCandidate[];
    request: AIRequest;
    policy: AIPolicy;
    options: ExecuteOptions;
    timeoutMs: number;
    trace: AITraceBuilder;
    requestId: string;
    streaming: boolean;
    structuredOutput: boolean;
    run: (
      candidate: AIRouteCandidate,
      provider: AIProvider,
      request: AIRequest,
    ) => Promise<T>;
    seal: (result: T) => T;
  }): Promise<T> {
    const { attempts, request, policy, options, timeoutMs, trace } = input;
    const required = deriveRequiredCapabilities(request, {
      streaming: input.streaming,
      structuredOutputRequired: policy.structuredOutput === 'required',
    });
    const retryPolicy = new AIRetryPolicy({ maxRetries: policy.maxRetries });

    let lastError: AIError | null = null;
    let lastCandidate: AIRouteCandidate = attempts[0];

    for (let index = 0; index < attempts.length; index += 1) {
      const candidate = attempts[index];
      lastCandidate = candidate;
      if (request.signal?.aborted) {
        throw new DOMException('AI request aborted before model attempt', 'AbortError');
      }

      const activeProvider = providerFor(candidate, options, index, input.primary);
      if (!activeProvider) continue;

      // The capability gate runs per candidate, before a single token is
      // spent. A candidate that cannot serve a `required` capability is skipped
      // — which is what "reroute rather than degrade" means in practice — and
      // only the last one standing is allowed to throw.
      const gaps = gapsFor(activeProvider.capabilities, candidate.provider, required);
      reportCapabilityGaps(gaps, {
        purpose: request.purpose,
        requestId: input.requestId,
        model: candidate.model,
      });
      const blocking = gaps.some((gap) => gap.level === 'required');
      if (blocking) {
        if (index < attempts.length - 1) continue;
        assertRequiredCapabilities(gaps, {
          provider: candidate.provider,
          purpose: request.purpose,
        });
      }

      if (index > 0) trace.recordProviderFallback(candidate.provider, candidate.model);

      try {
        const result = await retryPolicy.run(
          () => {
            const timeoutPolicy = new AITimeoutPolicy(timeoutMs);
            return timeoutPolicy.run(
              (signal) =>
                input.run(candidate, activeProvider, {
                  ...request,
                  requestId: input.requestId,
                  model: candidate.model,
                  signal,
                  timeoutMs,
                  responseFormat: input.structuredOutput ? 'json' : request.responseFormat,
                }),
              {
                externalSignal: request.signal,
                timeoutMessage: 'AI generation timed out.',
              },
            );
          },
          {
            // Classification by the adapter that owns the backend. This is the
            // single change that made the "provider-driven" path actually
            // provider-driven.
            shouldRetry: (error) => isRetryableError(activeProvider.classifyError(error)),
            normalizeError: (error) => activeProvider.classifyError(error),
            onRetry: () => trace.recordRetry(),
          },
        );
        recordProviderSuccess(candidate.provider);
        return input.seal(result);
      } catch (error) {
        const aiError = activeProvider.classifyError(error);
        lastError = aiError;
        if (reflectsProviderHealth(aiError)) recordProviderFailure(candidate.provider);
        if (aiError.category === 'aborted') throw attachTrace(aiError, trace.error('aborted'));

        const next = attempts[index + 1];
        if (!next) break;
        const sameProvider = next.provider === candidate.provider;
        const mayAdvance = sameProvider
          ? isModelFallbackCandidate(aiError, error)
          : policy.allowProviderFallback && isProviderFallbackCandidate(aiError);
        if (!mayAdvance) break;
      }
    }

    const finalError =
      lastError ??
      new AIError({
        category: 'configuration',
        provider: lastCandidate.provider,
        message: `No AI backend was available for "${request.purpose}".`,
        userMessage: 'No hay ningún proveedor de IA disponible para esta operación.',
        retryable: false,
        errorCode: 'no_provider_available',
      });
    throw attachTrace(finalError, trace.error(finalError.category));
  }

}

/**
 * The provider instance for a candidate.
 *
 * Returns `null` — meaning "skip this candidate" — when the plan names a
 * backend the caller gave no way to build. That is a caller that did not opt
 * into cross-provider fallback, not an error: the alternative is throwing on a
 * fallback nobody asked for.
 *
 * A free function rather than a method because the executor is a shared
 * singleton: holding the current request's provider on `this` would let two
 * concurrent generations read each other's backend.
 */
function providerFor(
  candidate: AIRouteCandidate,
  options: ExecuteOptions,
  index: number,
  primary: AIProvider,
): AIProvider | null {
  if (candidate.provider === primary.id) return primary;
  if (!options.resolveProvider) return index === 0 ? primary : null;
  try {
    return options.resolveProvider(candidate.provider);
  } catch {
    return null;
  }
}

/** Shared executor instance. */
export const aiRequestExecutor = new AIRequestExecutor();

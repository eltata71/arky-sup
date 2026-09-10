/**
 * Turn a request into a routed request: which backend serves it, what to try
 * after that, and how to build each candidate.
 *
 * This is the seam between `routing` (which decides) and `providers` (which
 * builds). It lives here rather than in `core` for a layering reason that is
 * load-bearing: `core` publishes the contracts that hide the adapters, so a
 * `core` module importing `AIProviderFactory` would make the contract layer
 * depend on the implementations it exists to hide. `core` therefore accepts a
 * plan and a resolver; this module produces them.
 */

import type { Settings } from '../../../types';
import type { AIPolicy } from '../core/AIPolicy';
import { resolvePolicy } from '../core/AIPolicy';
import type { AIProvider } from '../core/AIProvider';
import type { AIProviderId } from '../core/AIModel';
import type { AIRequest } from '../core/AIRequest';
import { deriveRequiredCapabilities } from '../core/AIRequest';
import { aiProviderFactory, type AIProviderFactory } from '../providers/AIProviderFactory';
import { planRoute } from './routePlanner';
import type { AIRoutePlan } from './routeTypes';

export interface RoutedRequest {
  /** The backend to call first. */
  provider: AIProvider;
  /** The ordered attempt list and the decision that produced it. */
  plan: AIRoutePlan;
  /** How the executor builds a provider for a later candidate. */
  resolveProvider: (id: AIProviderId) => AIProvider;
}

export interface RouteRequestInput {
  settings: Settings;
  request: AIRequest;
  /** Defaults to the policy for the request's mode. */
  policy?: AIPolicy;
  /** True when the caller will consume the answer as a stream. */
  streaming?: boolean;
  /** Providers a deployment permits. Empty means every registered one. */
  allowedProviders?: readonly AIProviderId[];
  /** Injected for tests; production uses the shared factory. */
  factory?: AIProviderFactory;
}

/**
 * Plan the route and build the primary provider.
 *
 * Throws `NoEligibleRouteError` when nothing registered can serve the request's
 * **required** capabilities — which is the correct outcome, and the one the
 * previous design could not produce: negotiation happened after the provider
 * had already been chosen, so a fatal gap had nowhere to go but a log line.
 */
export function routeRequest(input: RouteRequestInput): RoutedRequest {
  const factory = input.factory ?? aiProviderFactory;
  const policy = input.policy ?? resolvePolicy(input.request.mode);
  const required = deriveRequiredCapabilities(input.request, {
    streaming: input.streaming,
    structuredOutputRequired: policy.structuredOutput === 'required',
  });

  const plan = planRoute({
    tier: input.request.tier ?? policy.modelTier,
    required,
    settings: input.settings,
    modelOverride: input.request.modelOverride,
    allowModelFallback: policy.allowModelFallback,
    allowProviderFallback: policy.allowProviderFallback,
    allowedProviders: input.allowedProviders,
    capabilities: factory.capabilityMap(input.settings),
  });

  const resolveProvider = (id: AIProviderId): AIProvider =>
    factory.create({ settings: input.settings, provider: id });

  return { provider: resolveProvider(plan.primary.provider), plan, resolveProvider };
}

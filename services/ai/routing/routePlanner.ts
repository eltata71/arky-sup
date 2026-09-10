/**
 * The routing engine: eligibility, then ranking.
 *
 * `AIProviderFactory.createForCapability` picked "the first registered provider
 * whose boolean is true", in registration order. That is a lookup, not a
 * routing decision — it cannot express that a backend is degraded, that the
 * user prefers one, that one is cheaper for a mechanical hop, or that this
 * particular request cannot run on a backend that cannot enforce a schema.
 *
 * Routing here is two stages, and keeping them separate is the point:
 *
 *  1. **Eligibility** is a filter, and it is absolute. A candidate that cannot
 *     serve a `required` capability is removed, not penalised. Scores are
 *     comparable quantities; a missing guarantee is not a quantity, and mixing
 *     the two is how a cheap backend outranks a correct one.
 *  2. **Ranking** orders what is left, by policy. Every contribution is
 *     recorded in `factors`, so a total can be read rather than trusted.
 *
 * The result is deterministic: the same request, settings and health state
 * produce the same plan, and ties break on provider id so the order never
 * depends on `Map` iteration.
 */

import type { Settings } from '../../../types';
import { resolveInCatalog } from '../catalog/ProviderModelCatalog';
import { catalogFor, resolveProviderId } from '../catalog/catalogs';
import type { AIProviderCapabilities, AIRequiredCapability } from '../core/AICapabilities';
import { unmetCapabilities } from '../core/AICapabilities';
import type { AIProviderId, ModelTier } from '../core/AIModel';
import { CAPABILITY_LABELS } from '../core/AICapabilities';
import { providerCircuitState, providerHealthScore } from './providerHealth';
import type {
  AIRouteCandidate,
  AIRouteDecision,
  AIRoutePlan,
  AIRouteRejection,
  AIRouteScore,
} from './routeTypes';

export interface RoutePlanInput {
  /** Logical tier the policy asked for. */
  tier: ModelTier;
  /** What the request needs, already derived. */
  required: readonly AIRequiredCapability[];
  /** Settings carrier — supplies the configured provider and preferred model. */
  settings?: Settings;
  /** Explicit model id override, when the caller set one. */
  modelOverride?: string;
  /** May the plan try other models within a provider? */
  allowModelFallback: boolean;
  /**
   * May the plan try other *providers* after a failure?
   *
   * Independent of `allowModelFallback` on purpose. Switching vendor is a
   * different decision from switching model — it changes who processes the
   * data — so it stays an operator's switch rather than a consequence of
   * enabling retries. A reroute forced by a missing **required** capability is
   * not governed by this flag: there the alternative is failing or lying.
   */
  allowProviderFallback: boolean;
  /** Providers a deployment permits at all. Empty/undefined means "any
   *  registered one" — a residency or procurement rule narrows it. */
  allowedProviders?: readonly AIProviderId[];
  /** Capabilities of each registered provider, injected so the planner never
   *  has to construct one. */
  capabilities: ReadonlyMap<AIProviderId, AIProviderCapabilities>;
  /** Clock, injected for deterministic tests. */
  now?: number;
}

/** Thrown when no registered backend can serve the request's requirements. */
export class NoEligibleRouteError extends Error {
  constructor(
    readonly required: readonly AIRequiredCapability[],
    readonly rejected: readonly AIRouteRejection[],
  ) {
    const names = required
      .filter((need) => need.level === 'required')
      .map((need) => CAPABILITY_LABELS[need.capability])
      .join(', ');
    super(
      names.length > 0
        ? `No registered AI provider can serve the required capabilities: ${names}.`
        : 'No registered AI provider is available for this request.',
    );
    this.name = 'NoEligibleRouteError';
  }
}

/** Weights the ranker applies. Named so a change is a decision, not a nudge. */
const WEIGHTS = {
  /** The provider the user configured. Strongest single signal: an explicit
   *  choice outranks our own preferences, but not a required capability. */
  configuredProvider: 100,
  /** Health, scaled. An outage has to be able to outweigh a mild preference. */
  health: 60,
  /** Serving a `preferred` capability the others cannot. */
  preferredCapability: 25,
  /** Ties broken deterministically rather than by map order. */
  registrationOrder: 1,
} as const;

/**
 * Build the ordered attempt list for one request.
 *
 * Throws `NoEligibleRouteError` when nothing is eligible. That is the correct
 * outcome and the one the old code could not reach: `createForCapability`
 * threw a bare `Error` naming a capability, with no record of what was
 * considered, and the caller had nothing to show a user beyond the message.
 */
export function planRoute(input: RoutePlanInput): AIRoutePlan {
  const now = input.now ?? Date.now();
  const configured = resolveProviderId(input.settings);
  const rejected: AIRouteRejection[] = [];
  const eligible: AIRouteCandidate[] = [];
  const order = Array.from(input.capabilities.keys());

  for (const provider of order) {
    const capabilities = input.capabilities.get(provider);
    if (!capabilities) continue;

    if (input.allowedProviders && input.allowedProviders.length > 0 &&
        !input.allowedProviders.includes(provider)) {
      rejected.push({
        provider,
        reason: 'provider-not-allowed',
        detail: 'La política de la organización no permite este proveedor.',
      });
      continue;
    }

    const missing = unmetCapabilities(capabilities, input.required, 'required');
    if (missing.length > 0) {
      rejected.push({
        provider,
        reason: 'missing-required-capability',
        missing,
        detail: `No admite: ${missing.map((m) => CAPABILITY_LABELS[m.capability]).join(', ')}.`,
      });
      continue;
    }

    const resolution = resolveInCatalog(
      catalogFor(provider),
      input.tier,
      // A model preference belongs to the provider it was chosen for. Offering
      // it to every catalog would have each of them reject a foreign id and
      // silently fall back, which reads in a trace as a user choice that was
      // honoured everywhere and applied nowhere.
      provider === configured ? (input.modelOverride ?? input.settings?.aiConfig?.model) : undefined,
    );
    eligible.push({
      provider,
      model: resolution.id,
      tier: input.tier,
      source: resolution.source,
      capabilities,
    });
  }

  if (eligible.length === 0) throw new NoEligibleRouteError(input.required, rejected);

  const scores = rank(eligible, { configured, now, required: input.required, order });
  const byKey = new Map(eligible.map((c) => [`${c.provider}:${c.model}`, c]));
  const ranked = scores
    .map((score) => byKey.get(`${score.provider}:${score.model}`))
    .filter((candidate): candidate is AIRouteCandidate => candidate !== undefined);

  const primary = ranked[0];
  const fallbacks: AIRouteCandidate[] = [];

  if (input.allowModelFallback) {
    for (const model of catalogFor(primary.provider).fallbackChain) {
      if (model === primary.model) continue;
      fallbacks.push({ ...primary, model, source: 'fallback' });
    }
  }

  if (input.allowProviderFallback) {
    for (const candidate of ranked.slice(1)) {
      fallbacks.push(candidate);
      if (!input.allowModelFallback) continue;
      for (const model of catalogFor(candidate.provider).fallbackChain) {
        if (model === candidate.model) continue;
        fallbacks.push({ ...candidate, model, source: 'fallback' });
      }
    }
  }

  const decision: AIRouteDecision = {
    required: input.required,
    considered: scores,
    rejected,
    reroutedForCapability:
      primary.provider !== configured &&
      rejected.some(
        (r) => r.provider === configured && r.reason === 'missing-required-capability',
      ),
  };

  return { primary, fallbacks, decision };
}

function rank(
  candidates: readonly AIRouteCandidate[],
  context: {
    configured: AIProviderId;
    now: number;
    required: readonly AIRequiredCapability[];
    order: readonly AIProviderId[];
  },
): readonly AIRouteScore[] {
  const preferred = context.required.filter((need) => need.level === 'preferred');

  const scored = candidates.map((candidate) => {
    const factors: Record<string, number> = {};

    factors.configuredProvider =
      candidate.provider === context.configured ? WEIGHTS.configuredProvider : 0;

    factors.health = providerHealthScore(candidate.provider, context.now) * WEIGHTS.health;

    const met = preferred.filter(
      (need) => unmetCapabilities(candidate.capabilities, [need]).length === 0,
    ).length;
    factors.preferredCapability = met * WEIGHTS.preferredCapability;

    // Registration order is the last word, so two otherwise identical backends
    // always rank the same way rather than however the map happened to iterate.
    const index = context.order.indexOf(candidate.provider);
    factors.registrationOrder =
      (context.order.length - (index < 0 ? context.order.length : index)) *
      WEIGHTS.registrationOrder;

    const score = Object.values(factors).reduce((sum, value) => sum + value, 0);
    return { provider: candidate.provider, model: candidate.model, score, factors };
  });

  return [...scored].sort((a, b) => b.score - a.score || a.provider.localeCompare(b.provider));
}

/** True when a backend's circuit is open right now — for diagnostics only. */
export const isCircuitOpen = (provider: AIProviderId, now = Date.now()): boolean =>
  providerCircuitState(provider, now) === 'open';

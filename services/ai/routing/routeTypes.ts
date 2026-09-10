/**
 * The vocabulary of a routing decision.
 *
 * `AIModelRouter` answered one question — which model id does this tier mean
 * for the configured provider — and answered it well. What it could not
 * express is the question an enterprise deployment actually asks: *given what
 * this request needs, which backends could serve it, which one should, and
 * what do we try when that one fails?*
 *
 * Those are three different answers and they are recorded separately here:
 * `AIRouteCandidate` is a backend/model pair that could serve the request,
 * `AIRoutePlan` is the ordered attempt list, and `AIRouteDecision` is the
 * explanation — every candidate considered, every candidate rejected and why.
 * The explanation is not decoration: a route that cannot be replayed after the
 * fact is a route nobody can be held to.
 */

import type { AIProviderCapabilities, AIRequiredCapability } from '../core/AICapabilities';
import type { AIProviderId, ModelSource, ModelTier } from '../core/AIModel';

/** One backend/model pair that could serve a request. */
export interface AIRouteCandidate {
  provider: AIProviderId;
  /** Concrete model id, in that provider's id space. */
  model: string;
  tier: ModelTier;
  /** Which configuration layer produced the model id. */
  source: ModelSource;
  /** What the backend can do — carried so nothing has to re-read it later. */
  capabilities: AIProviderCapabilities;
}

/** Why a candidate was excluded before ranking ever ran. */
export type AIRouteRejectionReason =
  | 'missing-required-capability'
  | 'provider-not-registered'
  | 'provider-not-allowed'
  | 'circuit-open';

export interface AIRouteRejection {
  provider: AIProviderId;
  model?: string;
  reason: AIRouteRejectionReason;
  /** The specific capabilities that were missing, when that is the reason. */
  missing?: readonly AIRequiredCapability[];
  /** One line a human can read in a diagnostics panel. */
  detail: string;
}

/** A candidate that survived eligibility, with the score that ordered it. */
export interface AIRouteScore {
  provider: AIProviderId;
  model: string;
  score: number;
  /** Each contribution, so a total can be read rather than trusted. */
  factors: Readonly<Record<string, number>>;
}

/**
 * The auditable record of one routing decision.
 *
 * Deliberately data, not prose: it is attached to the trace and rendered, and
 * a decision that can only be explained by re-running the ranker is not an
 * explanation.
 */
export interface AIRouteDecision {
  /** What the request needed, after derivation. */
  required: readonly AIRequiredCapability[];
  /** Every eligible candidate, with its score, best first. */
  considered: readonly AIRouteScore[];
  /** Every candidate excluded before ranking, with the reason. */
  rejected: readonly AIRouteRejection[];
  /** True when the configured provider could not serve a required capability
   *  and the plan therefore starts somewhere else. */
  reroutedForCapability: boolean;
}

/**
 * The ordered attempt list for one request.
 *
 * `attempts` is flat on purpose. Model fallback and provider fallback are
 * different policies — `allowModelFallback` and `allowProviderFallback` gate
 * them independently — but by the time a plan exists they have been resolved
 * into one sequence, and the executor should not be re-deciding policy while
 * it is failing over.
 */
export interface AIRoutePlan {
  /** First attempt. Always present — planning fails rather than returning none. */
  primary: AIRouteCandidate;
  /** Everything to try after `primary`, in order. */
  fallbacks: readonly AIRouteCandidate[];
  decision: AIRouteDecision;
}

/** Flatten a plan into the attempt sequence the executor walks. */
export function planAttempts(plan: AIRoutePlan): readonly AIRouteCandidate[] {
  return [plan.primary, ...plan.fallbacks];
}

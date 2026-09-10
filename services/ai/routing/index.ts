/**
 * `services/ai/routing` — which backend serves this request, and why.
 *
 * `planRoute` is the entry point. It answers with an ordered attempt list and
 * the decision that produced it; nothing else in the layer should be choosing
 * a provider.
 */

export {
  NoEligibleRouteError,
  isCircuitOpen,
  planRoute,
  type RoutePlanInput,
} from './routePlanner';
export { routeRequest } from './routeRequest';
export type { RoutedRequest, RouteRequestInput } from './routeRequest';
export { planAttempts } from './routeTypes';
export type {
  AIRouteCandidate,
  AIRouteDecision,
  AIRoutePlan,
  AIRouteRejection,
  AIRouteRejectionReason,
  AIRouteScore,
} from './routeTypes';
export {
  COOLDOWN_MS,
  FAILURE_THRESHOLD,
  providerCircuitState,
  providerHealthScore,
  providerHealthSnapshot,
  recordProviderFailure,
  recordProviderSuccess,
  resetProviderHealth,
  type CircuitState,
} from './providerHealth';

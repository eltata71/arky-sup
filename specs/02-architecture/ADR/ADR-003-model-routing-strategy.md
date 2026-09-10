---
artifact_id: 02-ARCH-ADR-003
version: 1.0.0
status: Accepted
created: 2026-09-06
project: Arky 10 (arkypro-1.0)
standard: Architecture Decision Record
---

# ADR-003: Model and Provider Routing Strategy

**Status:** Accepted
**Date:** 2026-09-06

---

## Context and Problem Statement

Backend selection had two implementations and neither was routing.

`AIProviderFactory.createForCapability` returned **the first registered provider
whose boolean was true**, in registration order. `geminiService` did not use it
at all: it read `resolveProviderId(settings)` and branched on `!== 'gemini'`.
Both answer *who is configured*, which is a different question from *who can
serve this request*. Neither could express health, cost, policy, or a request's
own requirements, and neither left any record of the decision.

Fallback had the matching gap: `AIPolicy` declared `allowModelFallback` and
`allowProviderFallback`, and only the first was implemented. A rate-limited key
walked its own provider's model chain and then failed.

## Decision

Routing is **two stages, kept separate**, in `services/ai/routing`:

1. **Eligibility — a filter, and absolute.** A candidate that cannot serve a
   `required` capability is *removed*, not penalised. Also removed: a provider
   outside the deployment's allow-list, or one with no registered builder.
2. **Ranking — comparative, and explained.** Survivors are scored from the
   user's configured provider (100), backend health (0–60), `preferred`
   capabilities served (25 each) and registration order as the tie-break. Every
   contribution is recorded in `factors`, so a total can be read rather than
   trusted.

Mixing the two into one blended score is the thing this design refuses: a score
can be outweighed, and a missing guarantee must not be.

The output is an `AIRoutePlan` — an ordered attempt list plus an
`AIRouteDecision` naming what was required, what was considered with its score,
and what was rejected with the reason. The decision travels on the `AITrace`.

**Model fallback and provider fallback stay independent policies.** Switching
model is a resilience decision; switching vendor changes who processes the data.
`allowProviderFallback` is off in every shipped preset and is the operator's
switch. The one exception is not governed by it: when the configured backend
cannot serve a **required** capability, rerouting is mandatory, because the
alternatives are failing or answering a different question from the one asked.

**Health is a circuit breaker, per backend, in memory.** Three consecutive
failures open it; sixty seconds later it goes half-open and one probe decides.
Two limits are deliberate: an open circuit *deprioritises rather than excludes*,
because a degraded backend that is the only one able to serve a required
capability still beats a certain failure; and only transport-level failures
count, so a 400 this app produced never opens a circuit against a vendor.

Weights encode one more decision worth stating: `configuredProvider` (100)
outranks `health` (60), so a user's explicit choice is never abandoned on the
strength of one 503. Health reorders the alternatives behind it.

## Consequences

Selection is deterministic, explainable and auditable, and `geminiService` now
routes rather than looks up — a request whose requirements the configured
backend cannot meet is rerouted before a token is spent.

Health state is per browser tab and dies with it. This is a frontend-first app
with no server of its own, and a persisted record would outlive the outage it
described. Cross-tab or cross-user health would need a backend this product
deliberately does not have.

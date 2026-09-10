---
artifact_id: 02-ARCH-ADR-002
version: 1.0.0
status: Accepted
created: 2026-09-06
project: Arky 10 (arkypro-1.0)
standard: Architecture Decision Record
---

# ADR-002: Canonical AI Provider Architecture

**Status:** Accepted
**Date:** 2026-09-06

---

## Context and Problem Statement

`services/ai` was already layered — contracts, adapters, router, executor — and
the layering was sound. What it was not was *agnostic in fact*. Four things
contradicted the documentation the layer shipped with:

1. **The executor was Gemini's.** `AIRequestExecutor`'s constructor read
   `classifier: AIErrorClassifier = geminiErrorClassifier`, and every call site
   used the default. So on the path documented as "provider-driven", failures
   from Anthropic and OpenRouter were stamped `provider: 'gemini'` and judged by
   heuristics scoped to Google's SDK. `AIProvider.classifyError` had existed
   since the interface was written and was called by nobody.
2. **Capabilities were partly fiction and partly guesswork.**
   `AIProviderFactory` published `embeddings` with no method behind it, so
   `createForCapability({ capability: 'embeddings' })` could only ever throw.
   Tool support was not in the contract at all: negotiation read it through
   `(provider as { supportsTools?: boolean })` and defaulted to *supported*.
   Meanwhile `GeminiProvider` — which does support tools — never put a `tools`
   key on its config, and `OpenRouterProvider` sent tools and then discarded the
   `tool_calls` that came back.
3. **A requirement had no strength.** Negotiation reported every gap identically
   and never blocked, so a policy declaring `structuredOutput: 'required'` ran
   anyway against a backend that cannot enforce a schema.
4. **The neutral contract carried a vendor payload.** `AIRequest.rawContents`
   was `unknown`, documented as "e.g. Gemini `Content[]`". Nothing set it, which
   is the tell: no canonical multimodal path existed.

## Decision

Make `services/ai` a **canonical AI kernel**, with one rule:

```
Domain / Agent / Orchestration → Canonical AI Kernel → Provider Adapter → Provider API
```

Concretely:

- **Classification belongs to the adapter; the decision does not.** Providers
  implement `classifyError`. What to do with the result — retry this model, try
  the next model, try the next backend, count it against the backend's health —
  is policy over the canonical `AIErrorCategory` and lives once in
  `errors/retryDecisions.ts`.
- **Capabilities are one record, declared per adapter.**
  `AIProviderCapabilities` replaces four loose booleans and adds `tools` and
  `files`. `embeddings` is removed rather than stubbed.
- **Requirements carry a level.** `required` is a routing constraint that
  reroutes and then fails; `preferred` biases ranking; `optional` only reports.
  Requirements are *derived* from the request's own shape, not trusted from the
  caller.
- **Content is canonical.** `AIContentPart` (text / image / file / tool-call /
  tool-result) replaces `rawContents`. `providerConfig` survives as the escape
  hatch of last resort but is keyed by provider, so a value written for one
  backend cannot reach another.

## Consequences

**Positive.** An adapter's declaration is now checkable, and the conformance
suite checks it: 93 assertions run identically against all three backends,
against what reaches the wire rather than against what the provider claims.
Adding a backend is a `capabilities` record, an adapter and a harness.

**Negative, and accepted.** The executor now trusts `classifyError` completely,
so an adapter that answers `unknown` to a 429 silently disables retry and
fallback for its own backend. This is why the conformance suite asserts the
four status→category mappings for every adapter, and why the mock provider in
the executor's own tests delegates to the shared classifier rather than stubbing
one: a stub that answered `unknown` to everything would be testing a backend no
adapter in this repository resembles.

**Not addressed here.** `services/geminiService.ts` still calls the Google SDK
directly with Gemini-shaped `contents` and `config`, because
`contentsToPrompt` flattens a multi-turn `Content[]` into one string and using
it for Gemini would regress every chat path. See ADR-003 for how routing works
around that, and *Residual debt* in `docs/ai-kernel.md`.

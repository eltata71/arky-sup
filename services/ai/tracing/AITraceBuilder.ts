/**
 * AITraceBuilder — assembles the `AITrace` for one request.
 *
 * Keeps timing + attribution bookkeeping out of the executor: the executor
 * calls `begin()` once, records routing/retry/fallback as it learns them, and
 * calls `success()`/`error()`/`fallback()` to seal the trace.
 */

import type { AIErrorCategory } from '../core/AIError';
import type { AIModelDescriptor } from '../core/AIModel';
import type { AIProviderId } from '../core/AIModel';
import type { AIGenerationModeId } from '../core/AIRequest';
import type { AIUsage } from '../core/AIResponse';
import type { AITrace, AITraceStatus } from '../core/AITrace';
import type { AIRouteDecision } from '../routing/routeTypes';
import type { GuardrailFinding } from '../guardrails/guardrailTypes';

let traceCounter = 0;

/** Mint a stable, human-readable request id. */
export function newRequestId(purpose: string): string {
  traceCounter = (traceCounter + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 8);
  return `ai-${slug(purpose)}-${Date.now().toString(36)}-${traceCounter.toString(36)}${random}`;
}

function slug(value: string): string {
  return (value || 'request')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'request';
}

export interface AITraceInit {
  requestId: string;
  operationId?: string;
  purpose: string;
  provider: AIProviderId;
  route: AIModelDescriptor;
  mode: AIGenerationModeId;
  timeoutMs: number;
  structuredOutput: boolean;
  streaming: boolean;
  contextPackId?: string;
  /** The routing decision, when the request was planned. */
  routeDecision?: AIRouteDecision;
}

export class AITraceBuilder {
  private readonly startedAtMs: number;
  private readonly startedAtIso: string;
  private retryCount = 0;
  private effectiveModel: string;
  private effectiveProvider: AIProviderId;
  private fallbackModelUsed = false;
  private fallbackProviderUsed = false;
  private localFallbackUsed = false;
  private guardrailFindings: readonly GuardrailFinding[] = [];

  constructor(private readonly init: AITraceInit) {
    this.startedAtMs = nowMs();
    this.startedAtIso = new Date().toISOString();
    this.effectiveModel = init.route.id;
    this.effectiveProvider = init.provider;
  }

  /** Record that a retry happened (called once per retry). */
  recordRetry(): void {
    this.retryCount += 1;
  }

  /** Record that the request fell through to a non-primary model. */
  recordModelFallback(model: string): void {
    this.effectiveModel = model;
    this.fallbackModelUsed = model !== this.init.route.id;
  }

  /**
   * Record that the request fell through to a different *backend*.
   *
   * Kept separate from `recordModelFallback` because the two are separate
   * policies: switching model is a resilience decision, switching vendor is a
   * governance one. A trace that collapsed them would make "we sent your
   * architecture brief to a different company" indistinguishable from "we used
   * the smaller model".
   */
  recordProviderFallback(provider: AIProviderId, model: string): void {
    this.effectiveProvider = provider;
    this.effectiveModel = model;
    this.fallbackProviderUsed = provider !== this.init.provider;
    this.fallbackModelUsed = model !== this.init.route.id;
  }

  /**
   * Record what a guardrail stage found.
   *
   * Accumulated rather than replaced: the input stage and the output stage both
   * report into the same trace, and a request that was warned about on the way
   * in and blocked on the way out has to show both halves.
   */
  recordGuardrailFindings(findings: readonly GuardrailFinding[]): void {
    if (findings.length === 0) return;
    this.guardrailFindings = [...this.guardrailFindings, ...findings];
  }

  /** Record that a deterministic local fallback produced the final content. */
  recordLocalFallback(): void {
    this.localFallbackUsed = true;
  }

  /** Current effective model — exposed for diagnostics. */
  get model(): string {
    return this.effectiveModel;
  }

  /** Current effective provider — exposed for diagnostics. */
  get provider(): AIProviderId {
    return this.effectiveProvider;
  }

  private seal(status: AITraceStatus, errorCategory?: AIErrorCategory, usage?: AIUsage): AITrace {
    return {
      requestId: this.init.requestId,
      operationId: this.init.operationId,
      purpose: this.init.purpose,
      provider: this.effectiveProvider,
      providerRequested: this.init.provider,
      fallbackProviderUsed: this.fallbackProviderUsed,
      modelRequested: this.init.route.requested ?? this.init.route.id,
      modelEffective: this.effectiveModel,
      modelSource: this.init.route.source,
      fallbackModelUsed: this.fallbackModelUsed,
      fallbackModel: this.fallbackModelUsed ? this.effectiveModel : undefined,
      tier: this.init.route.tier,
      mode: this.init.mode,
      retryCount: this.retryCount,
      timeoutMs: this.init.timeoutMs,
      durationMs: Math.max(0, Math.round(nowMs() - this.startedAtMs)),
      structuredOutput: this.init.structuredOutput,
      streaming: this.init.streaming,
      status,
      errorCategory,
      localFallbackUsed: this.localFallbackUsed,
      contextPackId: this.init.contextPackId,
      usage,
      routeDecision: this.init.routeDecision,
      guardrails: this.guardrailFindings.length > 0 ? this.guardrailFindings : undefined,
      startedAt: this.startedAtIso,
      finishedAt: new Date().toISOString(),
    };
  }

  /** Seal a successful trace. */
  success(usage?: AIUsage): AITrace {
    return this.seal('success', undefined, usage);
  }

  /** Seal a fallback trace (recovered via local/alternate path). */
  fallback(errorCategory?: AIErrorCategory, usage?: AIUsage): AITrace {
    return this.seal('fallback', errorCategory, usage);
  }

  /** Seal a terminal-error trace. */
  error(errorCategory: AIErrorCategory): AITrace {
    return this.seal(this.localFallbackUsed ? 'fallback' : 'error', errorCategory);
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

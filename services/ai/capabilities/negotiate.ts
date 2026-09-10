/**
 * Capability negotiation — degradation is allowed, silence is not, and a
 * *required* guarantee is not degradable at all.
 *
 * Providers differ in what they can do, and asking one for something it cannot
 * offer is a normal event rather than an error: the request should still run,
 * with less. What is not acceptable is the shape this took before — the call
 * succeeded, the guarantee quietly weakened, and every layer above kept
 * treating the result as if the guarantee had held.
 *
 * Two things were missing from the first version of that idea:
 *
 *  - **Strength.** Every gap was reported the same way and none of them ever
 *    blocked, so a policy that said `structuredOutput: 'required'` and a
 *    provider that cannot enforce a schema produced a request that ran anyway.
 *    A requirement that never stops anything is a preference with a stern name.
 *  - **A place to act.** Reporting happened after the provider had already been
 *    chosen, so even a fatal gap had nowhere to go but the log. Routing is
 *    where a required capability belongs, and `services/ai/routing` reads the
 *    same requirements this module reports on.
 *
 * So: `required` reroutes and, failing that, throws; `preferred` and `optional`
 * are reported into the trace and observability and the request proceeds.
 */

import { observabilityService } from '../../observability';
import { AIError } from '../core/AIError';
import {
  CAPABILITY_LABELS,
  providerSupports,
  type AICapabilityLevel,
  type AICapabilityName,
  type AIProviderCapabilities,
  type AIRequiredCapability,
} from '../core/AICapabilities';
import type { AIProviderId } from '../core/AIModel';
import type { AIProvider } from '../core/AIProvider';
import { deriveRequiredCapabilities, type AIRequest } from '../core/AIRequest';

/** One capability the active provider cannot serve for this request. */
export interface CapabilityGap {
  capability: AICapabilityName;
  provider: AIProviderId;
  /** How badly the request needed it. */
  level: AICapabilityLevel;
  /** What the caller actually loses, in plain terms. */
  effect: string;
}

/** What is lost when a capability is missing, in the user's language. */
const EFFECTS: Readonly<Record<AICapabilityName, string>> = {
  'structured-output':
    'La salida no queda restringida al esquema pedido; el resultado se valida después en lugar de garantizarse.',
  tools:
    'El modelo no podrá invocar funciones; la acción tendrá que resolverse desde el texto de la respuesta.',
  streaming: 'La respuesta llegará completa al final en lugar de token a token.',
  images: 'El modelo no verá la imagen adjunta; responderá sólo a partir del texto.',
  files: 'El modelo no leerá el documento adjunto; responderá sólo a partir del texto.',
  audio: 'El proveedor no admite audio para esta petición.',
};

/** What this request needs, compared against what the provider offers. */
export function negotiateCapabilities(
  provider: AIProvider,
  request: AIRequest,
  options: { streaming?: boolean; structuredOutputRequired?: boolean } = {},
): CapabilityGap[] {
  const needs = deriveRequiredCapabilities(request, options);
  return gapsFor(provider.capabilities, provider.id, needs);
}

/** The gaps between a capability record and a set of requirements. */
export function gapsFor(
  capabilities: AIProviderCapabilities,
  provider: AIProviderId,
  needs: readonly AIRequiredCapability[],
): CapabilityGap[] {
  const gaps: CapabilityGap[] = [];
  for (const need of needs) {
    if (providerSupports(capabilities, need.capability)) continue;
    gaps.push({
      capability: need.capability,
      provider,
      level: need.level,
      effect: need.reason ? `${EFFECTS[need.capability]} (${need.reason})` : EFFECTS[need.capability],
    });
  }
  return gaps;
}

/**
 * Refuse to run when a `required` capability cannot be served.
 *
 * This is the one place in the layer that turns a capability gap into a
 * failure, and it is deliberate: the router has already tried every eligible
 * backend by the time execution reaches here, so a required gap that survives
 * means no route exists. Failing loudly is the only honest outcome — the
 * alternative is a diagram claiming to follow a schema it was never held to.
 */
export function assertRequiredCapabilities(
  gaps: readonly CapabilityGap[],
  context: { provider: AIProviderId; purpose: string },
): void {
  const blocking = gaps.filter((gap) => gap.level === 'required');
  if (blocking.length === 0) return;
  const names = blocking.map((gap) => CAPABILITY_LABELS[gap.capability]).join(', ');
  throw new AIError({
    category: 'configuration',
    provider: context.provider,
    message: `Provider ${context.provider} cannot serve required capabilities [${blocking
      .map((gap) => gap.capability)
      .join(', ')}] for "${context.purpose}".`,
    userMessage: `El proveedor de IA configurado no admite lo que esta operación necesita (${names}). Cambia de proveedor o de modelo en Configuración > IA.`,
    retryable: false,
    errorCode: 'required_capability_unavailable',
  });
}

/**
 * Report the gaps found for a request. Returns them unchanged so a caller can
 * attach them to a trace in the same expression.
 *
 * Deliberately non-fatal: blocking is `assertRequiredCapabilities`'s job. The
 * report exists so that when a diagram comes back worse after a provider
 * switch, the reason is already recorded rather than needing to be re-derived.
 */
export function reportCapabilityGaps(
  gaps: readonly CapabilityGap[],
  context: { purpose: string; requestId?: string; model?: string },
): readonly CapabilityGap[] {
  if (gaps.length === 0) return gaps;

  for (const gap of gaps) {
    observabilityService.recordWarning({
      source: 'operation',
      title: `Capacidad no disponible en el proveedor: ${gap.capability}`,
      message: gap.effect,
      operationId: context.requestId,
      operationName: context.purpose,
      recoverable: gap.level !== 'required',
      userVisible: false,
      metadata: {
        capability: gap.capability,
        level: gap.level,
        provider: gap.provider,
        model: context.model,
        purpose: context.purpose,
      },
    });
  }
  return gaps;
}

/** Negotiate and report in one step. */
export function negotiateAndReport(
  provider: AIProvider,
  request: AIRequest,
  options: { streaming?: boolean; structuredOutputRequired?: boolean } = {},
): readonly CapabilityGap[] {
  const gaps = negotiateCapabilities(provider, request, options);
  return reportCapabilityGaps(gaps, {
    purpose: request.purpose,
    requestId: request.requestId,
    model: request.modelOverride ?? request.model,
  });
}

/**
 * Negotiate, report, and refuse when a required capability is missing.
 *
 * The order matters: the gap is recorded before the throw, so the diagnostics
 * panel can show *why* an operation refused rather than only that it did.
 */
export function negotiateOrThrow(
  provider: AIProvider,
  request: AIRequest,
  options: { streaming?: boolean; structuredOutputRequired?: boolean } = {},
): readonly CapabilityGap[] {
  const gaps = negotiateAndReport(provider, request, options);
  assertRequiredCapabilities(gaps, { provider: provider.id, purpose: request.purpose });
  return gaps;
}

/**
 * What the active provider can do for the *user interface*.
 *
 * The UI needs this before it renders a control, not after the call fails. An
 * action offered and then refused reads as a bug; an action that is absent, or
 * present with a reason, reads as a limit — and only one of those is honest
 * about a provider that simply cannot do the thing.
 */
export type ProviderCapabilities = AIProviderCapabilities & { provider: AIProviderId };

/** Read the declared capabilities of a provider instance. */
export function readCapabilities(provider: AIProvider): ProviderCapabilities {
  return { provider: provider.id, ...provider.capabilities };
}

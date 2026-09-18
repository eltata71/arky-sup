/**
 * aiProxyEnforcement — the one place a direct browser→provider call is allowed
 * or refused.
 *
 * Three concerns are kept apart so each stays testable on its own:
 *   - `aiProxyPolicy`  — the types and the rule, no dependencies.
 *   - `byokConsent`    — did the user supply their own key?
 *   - this module      — composes them, records the refusal, and throws.
 *
 * Call sites get one function. That matters: the previous design spread the
 * fall-back decision across two files and four branches, which is why one of
 * them (guided creation) drifted for a while without anyone noticing.
 */

import type { Settings } from '../../types';
import { observabilityService } from '../observability';
import { hasConsentedByok } from './byokConsent';
import {
  AiProxyEnforcementError,
  decideFallback,
  isStrictProxyEnforced,
  proxyFailure,
  rateLimitOrigin,
  type AiProxyFailure,
  type AiProxyFailureReason,
} from './aiProxyPolicy';

/**
 * Decide whether the caller may now call the provider directly.
 *
 * Returns normally when the direct path is allowed — with enforcement off,
 * that is always, so this is a no-op on the default configuration. Throws
 * `AiProxyEnforcementError` when it is not, after recording the refusal so a
 * blocked deployment is visible in the observability centre instead of looking
 * like an AI feature that mysteriously does nothing.
 */
export function assertDirectCallAllowed(
  settings: Settings | undefined,
  failure: AiProxyFailure,
): void {
  if (decideFallback(failure, { byokConsented: hasConsentedByok(settings) }) === 'direct') return;

  const error = new AiProxyEnforcementError(failure);
  observabilityService.reportError(error, {
    source: 'network',
    title: 'Llamada directa al proveedor de IA bloqueada',
    severity: failure.retryable ? 'warning' : 'error',
    operationName: 'ai.proxy.enforcement',
    // The same id the proxy logged the refused call under. Without it a
    // support request reduces to matching timestamps by eye.
    traceId: failure.traceId,
    recoverable: error.recoverable,
    userVisible: true,
    metadata: {
      reason: failure.reason,
      status: failure.status,
      retryable: failure.retryable,
      traceId: failure.traceId,
      strictProxy: isStrictProxyEnforced(),
      // Lo que faltaba para poder cerrar un diagnóstico sin repetir el
      // incidente: el código y el origen que el proxy declaró. El evento
      // anterior guardaba `reason: 'rate-limited'` y nada más, así que un 429
      // del límite local y otro de la cuota del proveedor quedaban registrados
      // como el mismo hecho. `rateLimitOrigin` devuelve `unknown` cuando no se
      // pudo determinar, en vez de elegir el más probable.
      serverCode: failure.serverCode,
      serverSource: failure.serverSource,
      provider: failure.provider,
      rateLimitOrigin: rateLimitOrigin(failure),
      detail: failure.detail,
    },
  });
  throw error;
}

/** Shorthand for the guard sites that only carry a reason. */
export function assertDirectCallAllowedFor(
  settings: Settings | undefined,
  reason: AiProxyFailureReason,
): void {
  assertDirectCallAllowed(settings, proxyFailure(reason, { retryable: false }));
}

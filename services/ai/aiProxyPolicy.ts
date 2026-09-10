/**
 * aiProxyPolicy — who is allowed to talk to a model provider, and what happens
 * when the proxy says no.
 *
 * The proxy exists so a provider key never reaches the browser. That guarantee
 * was only ever best-effort: `callAiProxy` collapsed every failure into `null`
 * and the caller retried directly against the provider with the key from
 * `import.meta.env`. A misconfigured or briefly unavailable proxy therefore
 * reopened the exact exposure it was built to close, and did it silently — the
 * only trace was a `console.warn` nobody reads.
 *
 * Two things are separated here, because conflating them is what made the hole
 * invisible:
 *
 *  - **What happened** — `AiProxyOutcome`, a discriminated union. A 429 and a
 *    DNS failure and a malformed body are three different events; `null` made
 *    them one.
 *  - **What to do about it** — `decideFallback`, one function, one rule.
 *
 * Production is fail-closed by default. `VITE_AI_STRICT_PROXY` remains useful
 * as a development override, but a production build cannot opt out: availability
 * must never reopen the client-side operator-key path.
 *
 * The one direct call strict mode still permits is BYOK — a key the user typed
 * into Settings themselves. That is not a leak of the operator's credential;
 * it is the user spending their own, knowingly. Forbidding it would protect
 * nobody and remove a documented feature.
 */

/** Why a proxy call did not produce text. */
export type AiProxyFailureReason =
  /**
   * The proxy is not in the path: no endpoint to call, nothing answering as
   * the proxy at the one we have, or a proxy that is deployed without a
   * provider key. All three are configuration, and none of them improves by
   * being retried — which is what separates them from every other reason here.
   */
  | 'not-configured'
  /** The proxy rejected the caller's identity (401/403). */
  | 'unauthenticated'
  /** The proxy or the provider throttled the call (429). */
  | 'rate-limited'
  /** The proxy reached the provider and the provider failed (5xx, 4xx). */
  | 'provider-error'
  /** The proxy was unreachable: DNS, TLS, offline, aborted. */
  | 'network'
  /** The proxy answered 2xx with a body that carried no usable text. */
  | 'malformed'
  /**
   * The request itself cannot be proxied — today: tool/function calling, which
   * `api/ai.ts` does not forward, and providers the proxy cannot route.
   */
  | 'unsupported-request';

export interface AiProxySuccess<T> {
  ok: true;
  value: T;
}

export interface AiProxyFailure {
  ok: false;
  reason: AiProxyFailureReason;
  /** HTTP status when the proxy answered at all. */
  status?: number;
  /** Server-advised wait before retrying, when it sent one. */
  retryAfterMs?: number;
  /** Whether retrying the same call could plausibly succeed. */
  retryable: boolean;
  /** Short, already-truncated server detail. Never contains the prompt. */
  detail?: string;
  /**
   * Correlates the failure with the proxy's own log line. Present whenever the
   * call reached `aiProxyClient`, which is every path except a policy refusal
   * raised before one was minted.
   */
  traceId?: string;
}

export type AiProxyOutcome<T> = AiProxySuccess<T> | AiProxyFailure;

/**
 * Type guards, rather than a bare `if (outcome.ok)`.
 *
 * `tsconfig.json` still has `strictNullChecks: false`, and without it
 * TypeScript will not narrow a union on a boolean-literal discriminant — the
 * `ok` field reads as plain `boolean` and every field of the other member
 * becomes an error. An explicit predicate narrows regardless, so this file
 * does not have to wait for the strictness work to be correct. When
 * `strict: true` lands these become redundant, not wrong.
 */
export function isProxySuccess<T>(outcome: AiProxyOutcome<T>): outcome is AiProxySuccess<T> {
  return outcome.ok === true;
}

export function isProxyFailure<T>(outcome: AiProxyOutcome<T>): outcome is AiProxyFailure {
  return outcome.ok === false;
}

export const proxySuccess = <T>(value: T): AiProxySuccess<T> => ({ ok: true, value });

export const proxyFailure = (
  reason: AiProxyFailureReason,
  extra: Omit<AiProxyFailure, 'ok' | 'reason' | 'retryable'> & { retryable?: boolean } = {},
): AiProxyFailure => ({
  ok: false,
  reason,
  retryable: extra.retryable ?? RETRYABLE_BY_DEFAULT.has(reason),
  status: extra.status,
  retryAfterMs: extra.retryAfterMs,
  detail: extra.detail,
  traceId: extra.traceId,
});

/**
 * Reasons where the same call, sent again, could plausibly succeed. A 401 is
 * not here: the token will not become valid by repeating the request.
 */
const RETRYABLE_BY_DEFAULT = new Set<AiProxyFailureReason>([
  'rate-limited',
  'network',
  'provider-error',
]);

/** Map an HTTP status from the proxy onto a reason. */
export function classifyProxyStatus(status: number): AiProxyFailureReason {
  if (status === 401 || status === 403) return 'unauthenticated';
  if (status === 429) return 'rate-limited';
  return 'provider-error';
}

/**
 * Read `Retry-After` (seconds, or an HTTP date) into milliseconds.
 * Returns `undefined` when the header is absent or unparseable, which the
 * retry policy already treats as "use my own backoff".
 */
export function parseRetryAfterMs(headerValue: string | null | undefined): number | undefined {
  if (!headerValue) return undefined;
  const trimmed = headerValue.trim();
  if (!trimmed) return undefined;

  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);

  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

/**
 * Whether this build enforces the proxy.
 *
 * Deliberately a string comparison against `'true'`: an unset variable, an
 * empty string and a typo all mean "not enforced", which is the safe default
 * for availability. The unsafe default (leaking a key) is the one that needs
 * the explicit opt-in, and it is the other branch.
 */
export function isStrictProxyEnforced(): boolean {
  return import.meta.env.PROD || import.meta.env.VITE_AI_STRICT_PROXY === 'true';
}

export type FallbackDecision = 'direct' | 'fail-closed';

export interface FallbackContext {
  /**
   * True when the user has chosen to use their own key (`apiKeySource: 'user'`)
   * **and** that key is actually present. Both halves matter: the preference
   * alone, with no key stored, would fall through to the operator's key — the
   * very substitution this policy exists to prevent.
   */
  byokConsented: boolean;
}

/**
 * The single rule.
 *
 * Development without enforcement → direct fallback remains available.
 * Enforcing → `'direct'` only for a consented BYOK call; everything else stops.
 */
export function decideFallback(_failure: AiProxyFailure, context: FallbackContext): FallbackDecision {
  if (!isStrictProxyEnforced()) return 'direct';
  return context.byokConsented ? 'direct' : 'fail-closed';
}

/**
 * Raised instead of quietly calling the provider from the browser.
 *
 * It carries the failure so the UI can tell "the proxy is rate-limiting you,
 * try in a minute" apart from "this deployment has no proxy configured" —
 * a distinction `null` destroyed, and the reason a user could previously see
 * only an unexplained absence of output.
 */
export class AiProxyEnforcementError extends Error {
  override readonly name = 'AiProxyEnforcementError';
  readonly failure: AiProxyFailure;
  /** Retryable failures are recoverable: the same action may work shortly. */
  readonly recoverable: boolean;

  constructor(failure: AiProxyFailure) {
    super(describeProxyFailure(failure));
    this.failure = failure;
    this.recoverable = failure.retryable;
  }
}

/** User-facing Spanish message for a failure. The UI language is Spanish. */
export function describeProxyFailure(failure: AiProxyFailure): string {
  switch (failure.reason) {
    case 'not-configured':
      // Named for what the reader can do, in both directions: the operator has
      // to finish configuring the deployment (the technical detail travels with
      // the event), and the user has a way through today without waiting.
      return 'La IA no está disponible en este despliegue: falta terminar de configurar '
        + 'el proxy de IA o su clave de proveedor en el servidor. '
        + 'Mientras tanto puede usar su propia clave desde Ajustes → IA.';
    case 'unauthenticated':
      return 'El proxy de IA rechazó la sesión. Vuelva a iniciar sesión e inténtelo de nuevo.';
    case 'rate-limited':
      return 'El proxy de IA está limitando las solicitudes. Espere unos segundos y reintente.';
    case 'network':
      return 'No se pudo contactar al proxy de IA. Revise su conexión e inténtelo de nuevo.';
    case 'malformed':
      return 'El proxy de IA respondió sin contenido utilizable. Reintente la operación.';
    case 'unsupported-request':
      return 'Esta operación no puede ejecutarse a través del proxy de IA en este despliegue.';
    case 'provider-error':
    default:
      return 'El proveedor de IA falló detrás del proxy. Reintente en unos momentos.';
  }
}

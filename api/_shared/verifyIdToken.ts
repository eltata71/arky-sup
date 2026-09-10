/**
 * verifyIdToken — proves who is calling the AI proxy.
 *
 * The proxy exists to keep provider keys off the client. It did that, and then
 * spent them for anyone who asked: there was no caller authentication at all,
 * and the only control was a rate limit keyed on `x-arky-user-id` — a header
 * the caller writes. Rotating it produced unlimited fresh buckets.
 *
 * The client already knows who the user is; it was sending the uid as a bare
 * string. This module verifies the Firebase ID token instead, so the identity
 * the proxy bills against is one it checked rather than one it was told.
 *
 * ## Why not the Admin SDK
 *
 * `firebase-admin` verifies tokens too, but it wants service-account
 * credentials — a new server secret to provision and rotate for an app whose
 * whole Firebase configuration is otherwise public. Google documents the
 * manual procedure precisely so a stateless function can do this with the
 * public signing keys and nothing else, which is what this implements:
 * RS256 signature against Google's published JWKS, then the standard claim
 * checks (iss / aud / exp / iat / sub).
 *
 * ## Failure posture
 *
 * Rejection is safe here. `services/ai/aiProxyClient.ts` treats any proxy
 * failure as "use the direct path", so a rejected call degrades to the
 * client-side provider call rather than breaking the feature — the same
 * contract as an unconfigured proxy.
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Google's JWKS for Firebase ID tokens. Public, no credentials needed. */
const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/** Keys rotate roughly daily; an hour keeps the fetch rare and the cache fresh. */
const JWKS_TTL_MS = 60 * 60 * 1000;

/** Tolerance for clock skew between the signing service and this runtime. */
const CLOCK_SKEW_S = 60;

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
  use?: string;
}

interface JwksCache {
  keys: Map<string, Jwk>;
  fetchedAt: number;
}

let cache: JwksCache | null = null;

/** Reset the JWKS cache. Test seam only. */
export const resetJwksCache = (): void => {
  cache = null;
};

/** The verified identity of a caller. */
export interface VerifiedCaller {
  /** Firebase uid — the subject of the token. */
  uid: string;
  /** Email, when the token carries one. */
  email?: string;
}

/**
 * Result of a verification attempt.
 *
 * A flat shape rather than a discriminated union: this project does not yet
 * run with `strictNullChecks`, and without it TypeScript will not narrow the
 * union at the call site — the caller ends up unable to read `reason` on the
 * failure branch. One optional field each is less elegant and actually works.
 */
export interface VerifyOutcome {
  ok: boolean;
  /** Present when `ok` is true. */
  caller?: VerifiedCaller;
  /** Present when `ok` is false — a stable code, never a raw error message. */
  reason?: string;
}

const base64UrlDecode = (segment: string): Buffer =>
  Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const readJson = <T>(segment: string): T | null => {
  try {
    return JSON.parse(base64UrlDecode(segment).toString('utf8')) as T;
  } catch {
    return null;
  }
};

/** Fetch (and cache) Google's current signing keys. */
async function getSigningKeys(): Promise<Map<string, Jwk>> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < JWKS_TTL_MS) return cache.keys;

  const response = await fetch(JWKS_URL);
  if (!response.ok) {
    throw new Error(`JWKS fetch failed with ${response.status}`);
  }
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = new Map<string, Jwk>();
  for (const key of body.keys ?? []) {
    if (key.kid) keys.set(key.kid, key);
  }
  if (keys.size === 0) throw new Error('JWKS response carried no usable keys');

  cache = { keys, fetchedAt: now };
  return keys;
}

/** The Firebase project this proxy accepts tokens for. */
export const getExpectedProjectId = (): string | undefined => {
  const raw = process.env.FIREBASE_PROJECT_ID ?? process.env.VITE_FIREBASE_PROJECT_ID;
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  return trimmed.length > 0 ? trimmed : undefined;
};

/**
 * True when the operator has explicitly accepted an unauthenticated proxy.
 *
 * The escape hatch exists so an existing deployment can upgrade without an
 * outage while `FIREBASE_PROJECT_ID` is provisioned. It is opt-in, named for
 * what it does, and reported on every request that uses it — an operator
 * should be able to find it, not discover it.
 */
export const allowsUnauthenticated = (): boolean =>
  (process.env.AI_PROXY_ALLOW_UNAUTHENTICATED ?? '').trim().toLowerCase() === 'true';

/** Read the bearer token from the Authorization header. */
export const readBearerToken = (req: IncomingMessage): string | undefined => {
  const raw = req.headers['authorization'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length > 0 ? token : undefined;
};

/**
 * Verify a Firebase ID token.
 *
 * Checks, in order: shape, algorithm, key id, signature, then the claims.
 * The signature is checked before the claims are trusted for anything —
 * reading `sub` off an unverified token is how a "verified uid" ends up being
 * whatever the caller typed.
 */
export async function verifyIdToken(token: string): Promise<VerifyOutcome> {
  const projectId = getExpectedProjectId();
  if (!projectId) {
    return { ok: false, reason: 'proxy_missing_project_id' };
  }

  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed_token' };

  const [headerSegment, payloadSegment, signatureSegment] = parts;
  const header = readJson<{ alg?: string; kid?: string }>(headerSegment);
  const payload = readJson<{
    iss?: string;
    aud?: string;
    sub?: string;
    exp?: number;
    iat?: number;
    auth_time?: number;
    email?: string;
  }>(payloadSegment);

  if (!header || !payload) return { ok: false, reason: 'malformed_token' };
  if (header.alg !== 'RS256') return { ok: false, reason: 'unexpected_algorithm' };
  if (!header.kid) return { ok: false, reason: 'missing_key_id' };

  let jwk: Jwk | undefined;
  try {
    jwk = (await getSigningKeys()).get(header.kid);
  } catch {
    return { ok: false, reason: 'signing_keys_unavailable' };
  }
  if (!jwk) return { ok: false, reason: 'unknown_key_id' };

  let signatureValid: boolean;
  try {
    const publicKey = createPublicKey({ key: jwk as never, format: 'jwk' });
    signatureValid = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${headerSegment}.${payloadSegment}`, 'utf8'),
      publicKey,
      base64UrlDecode(signatureSegment),
    );
  } catch {
    return { ok: false, reason: 'signature_check_failed' };
  }
  if (!signatureValid) return { ok: false, reason: 'invalid_signature' };

  // Claims are only meaningful now that the signature holds.
  const nowS = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId) return { ok: false, reason: 'audience_mismatch' };
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    return { ok: false, reason: 'issuer_mismatch' };
  }
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S < nowS) {
    return { ok: false, reason: 'token_expired' };
  }
  if (typeof payload.iat !== 'number' || payload.iat - CLOCK_SKEW_S > nowS) {
    return { ok: false, reason: 'token_issued_in_future' };
  }
  if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
    return { ok: false, reason: 'missing_subject' };
  }

  return {
    ok: true,
    caller: { uid: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined },
  };
}

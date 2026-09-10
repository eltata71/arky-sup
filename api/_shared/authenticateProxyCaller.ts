/**
 * authenticateProxyCaller — the shared identity gate for both proxy endpoints.
 *
 * `api/ai.ts` and `api/gemini.ts` hold the same provider keys, so they need the
 * same lock. Keeping the decision here means a change to the posture — a new
 * claim to check, a different escape hatch — cannot be applied to one endpoint
 * and forgotten on the other.
 */

import type { IncomingMessage } from 'node:http';
import {
  allowsUnauthenticated,
  getExpectedProjectId,
  readBearerToken,
  verifyIdToken,
} from './verifyIdToken';

export interface ProxyAuthOutcome {
  allowed: boolean;
  /** The verified Firebase uid, when one was established. */
  uid?: string;
  /** Stable reason code when the call is rejected. */
  reason?: string;
}

/**
 * Decide whether a request may spend the operator's provider keys.
 *
 * Rejecting is safe: `services/ai/aiProxyClient.ts` treats any proxy failure as
 * "use the direct path", so a 401 degrades to the client-side provider call
 * rather than breaking the feature.
 */
export async function authenticateProxyCaller(
  req: IncomingMessage,
): Promise<ProxyAuthOutcome> {
  if (allowsUnauthenticated()) return { allowed: true };
  if (!getExpectedProjectId()) return { allowed: false, reason: 'proxy_missing_project_id' };

  const token = readBearerToken(req);
  if (!token) return { allowed: false, reason: 'missing_bearer_token' };

  const verified = await verifyIdToken(token);
  if (!verified.ok || !verified.caller) {
    return { allowed: false, reason: verified.reason ?? 'verification_failed' };
  }
  return { allowed: true, uid: verified.caller.uid };
}

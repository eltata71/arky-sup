/**
 * authenticateProxyCaller — the identity gate of the AI proxy.
 *
 * It was shared by `api/ai.ts` and the legacy `api/gemini.ts`, which held the
 * same provider keys and so needed the same lock. The legacy endpoint was
 * retired in F6-01; the gate stays in `_shared` because a posture decision —
 * a new claim to check, a different escape hatch — belongs in one place.
 *
 * Desde F9 hay un solo emisor aceptado: Supabase Auth. El verificador de tokens
 * de Firebase se retiró con el proveedor, y con él la ruta por `iss` que elegía
 * entre dos. Lo que queda comprueba el emisor de todos modos: un token de otro
 * sitio se rechaza con un motivo propio en vez de fallar más adentro con uno
 * genérico.
 */

import type { IncomingMessage } from 'node:http';
import {
  allowsUnauthenticated,
  getSupabaseAuthConfig,
  readBearerToken,
  readTokenIssuer,
  supabaseIssuerFor,
  verifySupabaseToken,
} from './verifySupabaseToken.js';

export interface ProxyAuthOutcome {
  allowed: boolean;
  /** The verified caller uid (`supabase:<auth-id>`). */
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
  const supabase = getSupabaseAuthConfig();
  if (!supabase) {
    return { allowed: false, reason: 'proxy_missing_project_id' };
  }

  const token = readBearerToken(req);
  if (!token) return { allowed: false, reason: 'missing_bearer_token' };

  if (readTokenIssuer(token) !== supabaseIssuerFor(supabase)) {
    return { allowed: false, reason: 'unexpected_issuer' };
  }

  const verified = await verifySupabaseToken(token, supabase);
  if (!verified.ok || !verified.caller) {
    return { allowed: false, reason: verified.reason ?? 'verification_failed' };
  }
  return { allowed: true, uid: verified.caller.uid };
}

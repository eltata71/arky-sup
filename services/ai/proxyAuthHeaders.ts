/**
 * proxyAuthHeaders — the one place the client proves who it is to the proxy.
 *
 * The proxy verifies a Supabase access token before it spends a provider key.
 * Two
 * modules call the proxy — `aiProxyClient` and the guided-creation service —
 * and they used to build their headers separately. That is how one of them was
 * left sending the old bare-uid header after the server started requiring a
 * token: the call kept "working" only because a proxy failure degrades to the
 * direct path, so guided creation quietly stopped using the server-side key
 * and went back to the one in the browser.
 *
 * A shared builder makes that drift impossible: there is one rule, and a change
 * to it cannot be applied to one caller and forgotten on the other. It mirrors
 * `api/_shared/authenticateProxyCaller.ts`, which does the same job on the
 * other side of the wire.
 */

import { TRACE_ID_HEADER } from '../../lib/traceId';

/**
 * Build the headers for a proxy request.
 *
 * `sessionId` is a coarse per-tab key the proxy uses only when it is running in
 * its explicitly unauthenticated mode; the token is what matters otherwise.
 *
 * Token retrieval is best-effort. When it fails the request goes out without
 * one, the proxy answers 401, and the caller degrades to the direct provider
 * path — the contract every call site is already written against.
 */
export async function buildProxyAuthHeaders(
  sessionId: string,
  traceId?: string,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-arky-session-id': sessionId,
  };
  // Lets the proxy log line and the browser event carry the same id, so a
  // report of "generation failed" can be followed across the wire instead of
  // guessing which server call it was.
  if (traceId) headers[TRACE_ID_HEADER] = traceId;
  try {
    // Dynamic import so the auth client stays out of the eager chunk: this
    // module is reached from the AI layer, which is itself lazy, and a static
    // import here would hoist the SDK into their common ancestor.
    const { currentAccessToken } = await import('../identity');
    const token = await currentAccessToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {
    // Leave the header off; the proxy rejects and the caller degrades.
  }
  return headers;
}

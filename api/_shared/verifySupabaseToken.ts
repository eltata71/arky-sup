/**
 * verifySupabaseToken — verifies a Supabase Auth access token for the pilot
 * cohort. The server-side allowlist is `SUPABASE_PILOT_EMAILS`; the
 * browser-visible `VITE_SUPABASE_PILOT_EMAILS` is a compatibility fallback and
 * is not itself a security boundary.
 *
 * The client (`services/ai/proxyAuthHeaders.ts`) sends the Supabase session
 * token for pilot users instead of a Firebase ID token, so the proxy must
 * accept it — verified, never trusted. Verification is server-side: Supabase
 * Auth validates signature/expiry/audience and returns the user
 * (`GET /auth/v1/user`, the getUser call). A forged `sub` therefore never
 * becomes a `supabase:<id>` uid.
 *
 * Failure posture matches the Firebase path: rejection is safe because the
 * client treats any proxy failure as "use the direct path".
 */

import type { VerifyOutcome } from './verifyIdToken.js';

export interface SupabaseAuthConfig {
  url: string;
  key: string;
  pilotEmails: readonly string[];
}

const parsePilotEmails = (value: string | undefined): readonly string[] =>
  [...new Set((value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0))];

/** Supabase Auth configuration, when the deployment provisioned it. */
export const getSupabaseAuthConfig = (): SupabaseAuthConfig | undefined => {
  const url = (process.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  const pilotEmails = parsePilotEmails(
    process.env.SUPABASE_PILOT_EMAILS ?? process.env.VITE_SUPABASE_PILOT_EMAILS,
  );
  return url.length > 0 && key.length > 0 ? { url, key, pilotEmails } : undefined;
};

/** The `iss` a genuine Supabase access token carries for this project. */
export const supabaseIssuerFor = (config: SupabaseAuthConfig): string =>
  `${config.url}/auth/v1`;

/**
 * Read the unverified `iss` claim. Routing hint only: every verifier below
 * validates fully, so a lying issuer just fails closed on the wrong path.
 */
export const readTokenIssuer = (token: string): string | undefined => {
  try {
    const segment = token.split('.')[1];
    if (!segment) return undefined;
    const payload = JSON.parse(
      Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as { iss?: unknown };
    return typeof payload.iss === 'string' ? payload.iss : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Verify a Supabase access token against the Auth server.
 *
 * Accepts only non-anonymous users with a non-empty id; anonymous sessions
 * carry no pilot email and must never spend the operator's provider keys.
 */
export async function verifySupabaseToken(
  token: string,
  config: SupabaseAuthConfig | undefined = getSupabaseAuthConfig(),
): Promise<VerifyOutcome> {
  if (!config) {
    return { ok: false, reason: 'proxy_missing_project_id' };
  }

  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.key, Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    return { ok: false, reason: 'verification_failed' };
  }
  if (!response.ok) {
    return { ok: false, reason: 'verification_failed' };
  }

  let body: { id?: unknown; email?: unknown; is_anonymous?: unknown } | null;
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { ok: false, reason: 'verification_failed' };
  }
  const id = typeof body?.id === 'string' ? body.id : '';
  if (id.length === 0) {
    return { ok: false, reason: 'verification_failed' };
  }
  if (body?.is_anonymous === true) {
    return { ok: false, reason: 'anonymous_caller' };
  }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (config.pilotEmails.length === 0 || !config.pilotEmails.includes(email)) {
    return { ok: false, reason: 'pilot_cohort_required' };
  }
  return { ok: true, caller: { uid: `supabase:${id}`, email } };
}

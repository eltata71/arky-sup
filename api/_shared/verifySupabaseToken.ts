/**
 * verifySupabaseToken — prueba quién llama al proxy de IA.
 *
 * El proxy existe para mantener las claves de proveedor fuera del cliente. Lo
 * hacía, y luego las gastaba para quien las pidiera: no había autenticación del
 * llamante y el único control era un límite de peticiones sobre `x-arky-user-id`,
 * una cabecera que escribe el propio llamante. Rotarla producía cubos nuevos
 * ilimitados.
 *
 * ## Dos comprobaciones, y las dos hacen falta
 *
 * 1. **El token es real.** Se valida contra `/auth/v1/user` del propio proyecto
 *    de Supabase. No se lee `sub` de un token sin verificar: así es como un
 *    «uid verificado» acaba siendo lo que el llamante tecleó.
 * 2. **La identidad tiene cuenta.** Autenticar no es existir. Se le pregunta a
 *    la base de datos, con el token de esa persona, si tiene un perfil activo
 *    (`api.load_own_profile`). Una identidad sin cuenta —o deshabilitada— no
 *    gasta la clave del operador.
 *
 * La segunda sustituye a la lista de correos del piloto, que era la forma que
 * tenía esto de decir «sólo esta gente» mientras Firebase seguía siendo el
 * proveedor principal. Con Supabase como proveedor único, la lista habría
 * significado «sólo estos de entre los que ya tienen cuenta», que es una
 * segunda autorización mantenida a mano y condenada a quedarse vieja.
 *
 * ## Postura ante el fallo
 *
 * Rechazar es seguro: `services/ai/aiProxyClient.ts` trata cualquier fallo del
 * proxy como «usa el camino directo», así que un 401 degrada a la llamada desde
 * el cliente en vez de romper la funcionalidad.
 */

import type { IncomingMessage } from 'node:http';

export interface SupabaseAuthConfig {
  url: string;
  key: string;
}

export interface VerifiedCaller {
  /** `supabase:<auth-id>`: prefijado para que nunca se confunda con otro id. */
  uid: string;
  email?: string;
}

export interface VerifyOutcome {
  ok: boolean;
  caller?: VerifiedCaller;
  /** Código estable cuando la verificación falla. */
  reason?: string;
}

/** Supabase Auth configuration, when the deployment provisioned it. */
export const getSupabaseAuthConfig = (): SupabaseAuthConfig | undefined => {
  const url = (process.env.VITE_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
  const key = (process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  return url.length > 0 && key.length > 0 ? { url, key } : undefined;
};

/** The `iss` a genuine Supabase access token carries for this project. */
export const supabaseIssuerFor = (config: SupabaseAuthConfig): string =>
  `${config.url}/auth/v1`;

/**
 * Read the unverified `iss` claim. Routing hint only: the verifier below
 * validates fully, so a lying issuer just fails closed.
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
 * True when the operator has explicitly accepted an unauthenticated proxy.
 *
 * The escape hatch exists so an existing deployment can upgrade without an
 * outage while the Supabase variables are provisioned. It is opt-in, named for
 * what it does, and reported on every request that uses it — an operator should
 * be able to find it, not discover it.
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

/** ¿Tiene esta sesión un perfil activo? Falla cerrado ante cualquier duda. */
async function hasActiveProfile(token: string, config: SupabaseAuthConfig): Promise<boolean> {
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/load_own_profile`, {
      method: 'POST',
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept-Profile': 'api',
        'Content-Profile': 'api',
      },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const body: unknown = await response.json();
    return Boolean(body) && typeof body === 'object' && typeof (body as { uid?: unknown }).uid === 'string';
  } catch {
    return false;
  }
}

/**
 * Verify a Supabase access token against the Auth server.
 *
 * Accepts only non-anonymous users with a non-empty id and a provisioned,
 * active profile; an anonymous session carries no account and must never spend
 * the operator's provider keys.
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
  if (!(await hasActiveProfile(token, config))) {
    return { ok: false, reason: 'account_required' };
  }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return { ok: true, caller: { uid: `supabase:${id}`, email } };
}

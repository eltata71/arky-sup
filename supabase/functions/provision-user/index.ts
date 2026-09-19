/**
 * provision-user — lo único que el navegador no puede hacer.
 *
 * Crear una identidad en Supabase Auth exige la clave de servicio, y esa clave
 * no puede vivir en el bundle: es texto que cualquiera descarga. Esta función
 * es, por tanto, el «backend confiable mínimo» que aprobó ADR-001, y su alcance
 * está deliberadamente recortado a dos verbos: **invitar** y **reinvitar**.
 *
 * Lo que NO hace, y es la mitad importante del diseño:
 *
 *  - **No escribe el perfil ni el rol.** El navegador, con la sesión del
 *    administrador, llama después a `api.provision_user_profile`, que comprueba
 *    `users:create`, comprueba que sólo un superadmin concede roles
 *    privilegiados, y deja la entrada de auditoría con el actor real. Si esta
 *    función escribiera el perfil, todas esas reglas tendrían que duplicarse
 *    aquí —y dos copias de una regla de autorización es una que se queda vieja.
 *  - **No confía en quien llama.** Verifica el token del administrador contra
 *    Supabase Auth y comprueba su permiso `users:create` preguntándoselo a la
 *    base de datos *como ese usuario*. Una función que crea identidades y
 *    acepta cualquier llamada es un registro abierto con otro nombre.
 *
 * Despliegue: `supabase functions deploy provision-user`. Usa las variables que
 * la plataforma inyecta (`SUPABASE_URL`, `SUPABASE_ANON_KEY`,
 * `SUPABASE_SERVICE_ROLE_KEY`); no hay secretos propios que configurar.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

interface ProvisionRequest {
  action?: 'invite' | 'resend';
  email?: string;
  displayName?: string;
  redirectTo?: string;
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (url === '' || anonKey === '' || serviceKey === '') {
    return json({ error: 'not_configured' }, 500);
  }

  const authorization = request.headers.get('Authorization') ?? '';
  if (!authorization.toLowerCase().startsWith('bearer ')) {
    return json({ error: 'unauthenticated' }, 401);
  }

  // El cliente del llamante: mismas políticas, mismo `auth.uid()`. Preguntarle
  // a la base de datos por sus permisos es lo que hace que la regla siga
  // estando escrita en un solo sitio.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: callerUser, error: callerError } = await caller.auth.getUser();
  if (callerError || !callerUser?.user) return json({ error: 'unauthenticated' }, 401);

  const { data: permissions, error: permissionError } = await caller
    .schema('api')
    .rpc('current_permissions');
  if (permissionError) return json({ error: 'permission_lookup_failed' }, 403);
  if (!Array.isArray(permissions) || !permissions.includes('users:create')) {
    return json({ error: 'forbidden' }, 403);
  }

  let body: ProvisionRequest;
  try {
    body = (await request.json()) as ProvisionRequest;
  } catch {
    return json({ error: 'invalid_body' }, 400);
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email.includes('@')) return json({ error: 'invalid_email' }, 400);
  const action = body.action ?? 'invite';
  const redirectTo = typeof body.redirectTo === 'string' && body.redirectTo.startsWith('http')
    ? body.redirectTo
    : undefined;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (action === 'resend') {
    const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) return json({ error: 'resend_failed', detail: error.message }, 400);
    return json({ ok: true }, 200);
  }

  const displayName = (body.displayName ?? '').trim();
  if (displayName.length < 2) return json({ error: 'invalid_name' }, 400);

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: displayName },
    redirectTo,
  });
  if (error) {
    const alreadyExists = /already been registered|already registered|duplicate/i.test(error.message);
    return json(
      { error: alreadyExists ? 'email_already_in_use' : 'invite_failed', detail: error.message },
      alreadyExists ? 409 : 400,
    );
  }
  const uid = data?.user?.id;
  if (typeof uid !== 'string' || uid === '') return json({ error: 'invite_failed' }, 500);

  // Devuelve el uid y nada más. El perfil y el rol los escribe el navegador con
  // la sesión del administrador, que es donde viven las reglas.
  return json({ ok: true, uid, email }, 200);
});

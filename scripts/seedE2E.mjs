#!/usr/bin/env node
/**
 * Siembra la cuenta y los datos que necesitan los recorridos E2E autenticados.
 *
 * Corre **solo** contra el stack local de Supabase (`supabase start`), cuyas
 * claves son públicas y fijas por diseño. Se niega a ejecutarse contra
 * cualquier otra URL: sembrar una cuenta con contraseña conocida en un proyecto
 * remoto sería crear una puerta trasera, y el error más fácil de cometer aquí
 * es apuntar por descuido a producción.
 *
 * El reparto es el mismo que en el producto: la identidad la crea la API de
 * administración con la clave de servicio —lo único que no se puede hacer sin
 * ella— y el perfil, con su rol, lo escribe una RPC. Aquí no hay un
 * administrador previo que la llame, así que el perfil se inserta con la clave
 * de servicio también; es el mismo caso que el primer administrador de una
 * instalación, y por eso `docs/primer-administrador.md` lo describe igual.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const EMAIL = process.env.E2E_EMAIL ?? 'architect@arky.e2e';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Arky-E2E-Only-2026!';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function assertLocal() {
  let host;
  try {
    host = new URL(SUPABASE_URL).hostname;
  } catch {
    throw new Error(`SUPABASE_URL no es una URL válida: ${SUPABASE_URL}`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Este seed crea una cuenta con contraseña conocida y solo puede correr contra el stack local. Recibió: ${host}`,
    );
  }
  if (!SERVICE_KEY) {
    throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY (la imprime `supabase status`).');
  }
}

const adminHeaders = () => ({
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
});

/** Crea la identidad, o devuelve la existente. Idempotente por diseño. */
async function ensureAuthUser() {
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: 'Arquitecto E2E' },
    }),
  });
  if (created.ok) {
    const payload = await created.json();
    if (typeof payload?.id === 'string') return payload.id;
  }

  // Ya existía: se busca por correo en el listado de administración.
  const listed = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, { headers: adminHeaders() });
  if (!listed.ok) throw new Error(`No se pudo listar usuarios: ${listed.status}`);
  const body = await listed.json();
  const match = (body?.users ?? []).find((user) => user?.email === EMAIL);
  if (typeof match?.id !== 'string') {
    throw new Error(`No se pudo crear ni encontrar la cuenta ${EMAIL}.`);
  }
  // Se reafirma la contraseña: una siembra anterior pudo usar otra.
  await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${match.id}`, {
    method: 'PUT',
    headers: adminHeaders(),
    body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
  });
  return match.id;
}

/**
 * Escribe el perfil directamente sobre la tabla.
 *
 * `api.user_profiles` no concede privilegios a `service_role` —es la postura
 * deny-by-default de ADR-003—, así que la escritura va por una función del seed,
 * que sólo existe en el stack local. Está en `public` y no en `api` porque los
 * tipos generados se sacan con `--schema api`: un ayudante de pruebas declarado
 * ahí sería una función que el código cree tener y que el proyecto remoto no
 * tiene. En un proyecto remoto esto no funciona, y es exactamente la protección
 * que se quiere: el bootstrap del primer administrador es una operación manual
 * y auditada, no un script.
 */
async function ensureProfile(uid) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/seed_e2e_profile`, {
    method: 'POST',
    // Sin cabecera de perfil: la función vive en `public`, que es el esquema por
    // defecto de la Data API.
    headers: adminHeaders(),
    body: JSON.stringify({ p_uid: uid, p_display_name: 'Arquitecto E2E' }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`No se pudo sembrar el perfil: ${response.status} ${detail}`);
  }
}

/**
 * Siembra la iniciativa, el proyecto y el encargo que los recorridos profundos
 * esperan encontrar.
 *
 * Se perdieron al portar este script de Firestore a Supabase: se portó la
 * cuenta y no los datos, y los dos recorridos de la Oficina quedaron buscando
 * un `e2e-project` y un `e2e-engagement-arb` que ya no creaba nadie. El
 * síntoma no era «faltan datos» sino «no aparece el desplegable de proyecto»,
 * que se parece a un fallo de la interfaz.
 */
async function ensureFixtures(uid) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/seed_e2e_fixtures`, {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({ p_uid: uid }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`No se pudieron sembrar los fixtures: ${response.status} ${detail}`);
  }
}

async function main() {
  assertLocal();
  const uid = await ensureAuthUser();
  await ensureProfile(uid);
  await ensureFixtures(uid);
  process.stdout.write(`E2E seed listo: ${EMAIL} (${uid}) + iniciativa, proyecto y encargo ARB\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

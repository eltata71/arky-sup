#!/usr/bin/env node
/**
 * assertProductionMigrations — no se publica un commit cuyo esquema producción no tiene (F6-10).
 *
 * `ci.yml` publica la aplicación y no el esquema: las migraciones se aplican a
 * mano, con aprobación (`docs/operacion/runbook-migraciones.md`). Una que llegó
 * tarde rompió producción una vez (F4-06), porque el código nuevo llamó a una
 * RPC que la base todavía no tenía.
 *
 * Este paso corre en el trabajo `deploy`, después de `vercel pull` y **antes de
 * construir**. Pregunta a producción, por cada fichero de
 * `supabase/migrations/`, si esa versión está aplicada
 * (`deploy_status.migration_applied`), con la clave publicable —ningún secreto
 * nuevo—. Si falta alguna, o si no puede preguntar, **no publica**: falla
 * cerrado. Una comprobación que se salta cuando no sabe responder es una
 * comprobación que falla el día que importa.
 *
 * Nunca imprime la URL ni la clave: el log de un build es público.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PREFIX = '[production-migrations]';
const RUNBOOK = 'docs/operacion/runbook-migraciones.md';

/** Las versiones del repositorio, en orden: los 14 dígitos de cada fichero. */
export function localMigrationVersions(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => ({ name, version: name.slice(0, 14) }))
    .filter(({ version }) => /^[0-9]{14}$/.test(version))
    .sort((a, b) => a.version.localeCompare(b.version));
}

/** `KEY="valor"` por línea, como lo escribe `vercel pull`. Sin interpretar nada más. */
export function parseEnvFile(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

/**
 * El veredicto sobre las respuestas. `answers` es una lista de
 * `{ name, version, applied: true | false | null, problem? }`, donde `null`
 * significa que no se pudo preguntar. Cualquier cosa distinta de «todas
 * aplicadas» impide publicar.
 */
export function assess(answers) {
  const unknown = answers.filter((answer) => answer.applied === null);
  const missing = answers.filter((answer) => answer.applied === false);
  if (answers.length === 0) {
    return { ok: false, reason: 'no hay migraciones que comprobar: ¿se leyó el directorio correcto?' };
  }
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `no se pudo comprobar ${unknown.length} migración(es); se publica sólo con el esquema confirmado`,
      details: unknown.map((answer) => `${answer.name}: ${answer.problem ?? 'sin respuesta'}`),
    };
  }
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `producción no tiene ${missing.length} migración(es) de este commit`,
      details: missing.map((answer) => answer.name),
    };
  }
  return { ok: true, reason: `las ${answers.length} migraciones del repositorio están aplicadas en producción` };
}

/** Pregunta por una versión. Nunca lanza: un fallo es `applied: null` con su motivo. */
export async function askProduction({ url, key, version, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(`${url.replace(/\/+$/, '')}/rest/v1/rpc/migration_applied`, {
      method: 'POST',
      headers: {
        apikey: key,
        'Content-Type': 'application/json',
        'Content-Profile': 'deploy_status',
        'Accept-Profile': 'deploy_status',
      },
      body: JSON.stringify({ p_version: version }),
    });
    const text = await response.text();
    if (!response.ok) {
      let code = '';
      try { code = JSON.parse(text).code ?? ''; } catch { /* cuerpo no JSON */ }
      const hint = code === 'PGRST106' || code === 'PGRST202'
        ? ' — la sonda no existe en producción o su esquema no está expuesto'
        : '';
      return { applied: null, problem: `HTTP ${response.status}${code ? ` ${code}` : ''}${hint}` };
    }
    const value = JSON.parse(text);
    if (value === true || value === false) return { applied: value };
    return { applied: null, problem: 'respuesta que no es sí ni no' };
  } catch (error) {
    return { applied: null, problem: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const envPath = resolve(process.env.VERCEL_ENV_FILE ?? '.vercel/.env.production.local');
  const fileValues = existsSync(envPath) ? parseEnvFile(readFileSync(envPath, 'utf8')) : {};
  const url = process.env.VITE_SUPABASE_URL || fileValues.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || fileValues.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error(`${PREFIX} ERROR: faltan VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY de producción (se leen de ${envPath}, que escribe \`vercel pull\`).`);
    process.exit(1);
  }

  const migrations = localMigrationVersions(resolve('supabase/migrations'));
  const answers = [];
  for (const migration of migrations) {
    answers.push({ ...migration, ...(await askProduction({ url, key, version: migration.version })) });
  }

  const verdict = assess(answers);
  if (verdict.ok) {
    console.log(`${PREFIX} OK — ${verdict.reason}.`);
    return;
  }
  console.error(`${PREFIX} ERROR: ${verdict.reason}.`);
  for (const detail of verdict.details ?? []) console.error(`${PREFIX}   ${detail}`);
  console.error(`${PREFIX} No se publica. Aplica lo que falte siguiendo ${RUNBOOK} y relanza el despliegue.`);
  process.exit(1);
}

if (process.argv[1] && process.argv[1].endsWith('assertProductionMigrations.mjs')) {
  main();
}


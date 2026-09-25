/**
 * El paso del despliegue que no publica un commit cuyo esquema producción no
 * tiene (F6-10). Lo que se prueba es lo que decide: qué versiones se leen, qué
 * cuenta como «aplicada», y que cualquier duda —una respuesta rara, una red
 * caída, la sonda ausente— impide publicar en vez de dejar pasar.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  askProduction,
  assess,
  localMigrationVersions,
  parseEnvFile,
} from '../../scripts/deploy/assertProductionMigrations.mjs';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

describe('las versiones del repositorio', () => {
  it('lee los 14 dígitos de cada migración, en orden, e ignora lo que no es una', () => {
    dir = mkdtempSync(join(tmpdir(), 'arky-migrations-'));
    writeFileSync(join(dir, '20260926140000_b.sql'), '');
    writeFileSync(join(dir, '20260912001855_a.sql'), '');
    writeFileSync(join(dir, 'README.md'), '');
    writeFileSync(join(dir, 'borrador.sql'), '');
    expect(localMigrationVersions(dir).map((m: { version: string }) => m.version))
      .toEqual(['20260912001855', '20260926140000']);
  });

  it('ve las migraciones reales del repositorio', () => {
    expect(localMigrationVersions(join(__dirname, '..', '..', 'supabase', 'migrations')).length).toBeGreaterThan(40);
  });
});

describe('el fichero que escribe vercel pull', () => {
  it('lee valores con y sin comillas, y nada más', () => {
    expect(parseEnvFile('# comentario\nVITE_SUPABASE_URL="https://x.supabase.co"\nOTRA=valor\n'))
      .toEqual({ VITE_SUPABASE_URL: 'https://x.supabase.co', OTRA: 'valor' });
  });
});

describe('el veredicto', () => {
  const ok = { name: 'a.sql', version: '20260912001855', applied: true };

  it('publica sólo si todas están aplicadas', () => {
    expect(assess([ok, { ...ok, name: 'b.sql' }]).ok).toBe(true);
  });

  it('no publica si falta una, y la nombra', () => {
    const verdict = assess([ok, { name: 'nueva.sql', version: '20260926140000', applied: false }]);
    expect(verdict.ok).toBe(false);
    expect(verdict.details).toEqual(['nueva.sql']);
  });

  it('no publica si no pudo preguntar: la duda no es un sí', () => {
    const verdict = assess([ok, { name: 'b.sql', version: '20260926140000', applied: null, problem: 'HTTP 503' }]);
    expect(verdict.ok).toBe(false);
    expect(verdict.details?.[0]).toContain('HTTP 503');
  });

  it('no publica si no hay nada que comprobar: eso es un directorio equivocado, no un esquema al día', () => {
    expect(assess([]).ok).toBe(false);
  });
});

describe('la pregunta a producción', () => {
  const ask = (fetchImpl: unknown) =>
    askProduction({ url: 'https://x.supabase.co/', key: 'clave', version: '20260926140000', fetchImpl: fetchImpl as typeof fetch });

  it('pregunta al esquema de la sonda, con la clave publicable, por esa versión', async () => {
    let seen: { url: string; init: { headers: Record<string, string>; body: string } } | undefined;
    await ask(async (url: string, init: { headers: Record<string, string>; body: string }) => {
      seen = { url, init };
      return response(200, true);
    });
    expect(seen?.url).toBe('https://x.supabase.co/rest/v1/rpc/migration_applied');
    expect(seen?.init.headers['Content-Profile']).toBe('deploy_status');
    expect(seen?.init.headers.apikey).toBe('clave');
    expect(JSON.parse(seen?.init.body ?? '{}')).toEqual({ p_version: '20260926140000' });
  });

  it('sí y no son respuestas', async () => {
    expect(await ask(async () => response(200, true))).toEqual({ applied: true });
    expect(await ask(async () => response(200, false))).toEqual({ applied: false });
  });

  it('cualquier otra cosa es no saber: una respuesta rara, un error HTTP, la red caída', async () => {
    expect((await ask(async () => response(200, 'null'))).applied).toBeNull();
    expect((await ask(async () => response(500, { code: 'XX000' }))).applied).toBeNull();
    expect((await ask(async () => { throw new Error('ECONNRESET'); })).applied).toBeNull();
  });

  it('dice qué pasa cuando la sonda no existe o su esquema no está expuesto', async () => {
    const answer = await ask(async () => response(404, { code: 'PGRST106' }));
    expect(answer.applied).toBeNull();
    expect(answer.problem).toContain('no está expuesto');
  });
});

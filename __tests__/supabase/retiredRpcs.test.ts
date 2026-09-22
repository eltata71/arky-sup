/**
 * Una RPC retirada no vuelve.
 *
 * `api.save_project_aggregate` recibía el proyecto y la lista entera de sus
 * artefactos, y borraba los que no viajaban en ella. ADR-106 hizo del Artefacto
 * la raíz de su propio agregado; F4-03 la dejó como ruta de transición y F4-06
 * la retiró cuando su último llamante —crear un proyecto, siempre con la lista
 * vacía— pasó a `api.save_project` con revisión esperada 0.
 *
 * Retirarla es tres cosas, y cada una puede deshacerse sin que nada más lo note:
 *
 *  - que la última migración que la nombra la **borre** (una migración posterior
 *    que la recree con `create or replace` la resucitaría, concedida o no);
 *  - que ningún fichero del cliente la **llame** (`rpcSurface.test.ts` sólo ve
 *    llamadas sin concesión, y una concesión re-añadida la haría pasar);
 *  - que el tipo generado **no la ofrezca**, porque lo que el tipo ofrece es lo
 *    que alguien acabará llamando.
 *
 * Se lee el texto, no el catálogo, por la misma razón que `rpcOverloads.test.ts`:
 * esto tiene que fallar en el bucle interno. El contrato pgTAP
 * (`hasnt_function`) comprueba la otra mitad contra una base real.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/** Cada entrada dice qué se retiró, cuándo y por qué, para que el fallo se explique solo. */
const RETIRED = [
  { name: 'save_project_aggregate', task: 'F4-06', replacement: 'api.save_project + comandos de artefacto (ADR-106)' },
] as const;

const sourceFiles = (directory: string): string[] => readdirSync(directory).flatMap((entry) => {
  const path = join(directory, entry);
  if (statSync(path).isDirectory()) return sourceFiles(path);
  return /\.(?:ts|tsx)$/.test(entry) ? [path] : [];
});

const migrations = (): Array<{ file: string; sql: string }> => readdirSync(MIGRATIONS)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS, file), 'utf8') }));

describe('RPC retiradas', () => {
  for (const retired of RETIRED) {
    describe(`api.${retired.name} (${retired.task})`, () => {
      it('la última migración que la nombra la borra, y ninguna posterior la recrea', () => {
        const create = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+api\\.${retired.name}\\s*\\(`, 'i');
        const drop = new RegExp(`drop\\s+function\\s+(?:if\\s+exists\\s+)?api\\.${retired.name}\\s*\\(`, 'i');
        let state: 'absent' | 'live' | 'dropped' = 'absent';
        let last = '';
        for (const { file, sql } of migrations()) {
          // Orden dentro del fichero: un `drop` seguido de un `create` la resucita.
          const events = [
            ...[...sql.matchAll(new RegExp(create.source, 'gi'))].map((match) => ({ index: match.index, kind: 'live' as const })),
            ...[...sql.matchAll(new RegExp(drop.source, 'gi'))].map((match) => ({ index: match.index, kind: 'dropped' as const })),
          ].sort((left, right) => left.index - right.index);
          for (const event of events) {
            state = event.kind;
            last = file;
          }
        }
        expect({ state, last }).toEqual({ state: 'dropped', last: expect.stringMatching(/\.sql$/) });
      });

      it('ningún fichero de producción la llama', () => {
        const pattern = new RegExp(`(?:callRpc(?:<[^>]+>)?|\\.rpc)\\(\\s*['"]${retired.name}['"]`);
        const callers = [join(ROOT, 'services'), join(ROOT, 'supabase', 'functions'), join(ROOT, 'context'), join(ROOT, 'hooks')]
          .flatMap(sourceFiles)
          .filter((file) => pattern.test(readFileSync(file, 'utf8')))
          .map((file) => relative(ROOT, file));
        expect(callers, `usa ${retired.replacement}`).toEqual([]);
      });

      it('el tipo generado no la ofrece', () => {
        const types = readFileSync(join(ROOT, 'supabase', 'database.types.ts'), 'utf8');
        expect(types).not.toMatch(new RegExp(`\\b${retired.name}\\s*:`));
      });
    });
  }
});

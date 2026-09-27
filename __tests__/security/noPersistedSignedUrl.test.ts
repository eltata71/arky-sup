/**
 * Una URL firmada no se guarda nunca (invariante T-01).
 *
 * Los cubos son privados y una URL firmada caduca: guardarla es guardar un
 * enlace roto o, si no caducara, una puerta pública a un objeto privado escrita
 * en la base de datos. Se guarda la **ruta** y se firma al abrir. Hasta aquí era
 * una convención escrita en CLAUDE.md y sin prueba (`07-invariantes.md` la
 * marcaba ⚠️); desde la revisión de deuda técnica del 2026-09-26 es esto.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

const filesUnder = (dir: string, pattern: RegExp): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (name === 'node_modules' || name === '__tests__') return [];
  if (statSync(path).isDirectory()) return filesUnder(path, pattern);
  return pattern.test(name) ? [path] : [];
});

const APP = ['services', 'components', 'pages', 'hooks', 'context', 'lib']
  .flatMap((dir) => filesUnder(join(ROOT, dir), /\.tsx?$/));

/** Quién puede pedir una URL firmada: el adaptador que la crea y el único que la abre. */
const SIGNERS = new Set([
  'services/adapters/supabaseFileStorage.ts',
  'hooks/useDocumentFile.ts',
]);

describe('las URLs firmadas no se persisten', () => {
  it('sólo el adaptador y quien abre el archivo piden una', () => {
    const callers = APP
      .filter((file) => /\.signedUrl\(|createSignedUrl\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file))
      .filter((file) => !SIGNERS.has(file));
    expect(callers).toEqual([]);
  });

  it('quien la pide la usa para abrir, y no la guarda en ningún sitio', () => {
    const source = readFileSync(join(ROOT, 'hooks/useDocumentFile.ts'), 'utf8');
    const signing = source.slice(source.indexOf('.signedUrl('));
    const block = signing.slice(0, signing.indexOf('}, ['));
    expect(block).toMatch(/window\.open\(url/);
    // Ni estado, ni comandos, ni escrituras con la URL dentro.
    expect(block).not.toMatch(/set[A-Z]\w*\([^)]*url/);
    expect(block).not.toMatch(/runInitiativeCommand|runProjectCommand|save|persist/i);
  });

  it('lo que se guarda de un documento es su ruta, no una URL', () => {
    const types = readFileSync(join(ROOT, 'services/businessInitiatives/domain/BusinessInitiativeTypes.ts'), 'utf8');
    const shape = types.slice(types.indexOf('export interface InitiativeDocumentFile'));
    const body = shape.slice(0, shape.indexOf('}'));
    expect(body).toMatch(/\bpath: string/);
    expect(body).not.toMatch(/\burl\b|signed/i);
  });

  it('ninguna migración tiene una columna ni una clave de URL firmada', () => {
    const offending = filesUnder(join(ROOT, 'supabase/migrations'), /\.sql$/)
      .filter((file) => /signed_?url/i.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file));
    expect(offending).toEqual([]);
  });
});

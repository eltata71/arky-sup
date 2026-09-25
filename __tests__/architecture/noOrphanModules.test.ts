/**
 * F6-01 · Ningún fichero de código sin consumidor.
 *
 * Seis ficheros vivían en el repositorio sin que nada los importara —cinco
 * componentes, uno de ellos un marcador vacío de 0 líneas que `CLAUDE.md`
 * tenía que advertir que no se usara, y un reexportador de una línea—. Un
 * fichero muerto no rompe nada, y ése es el problema: se lee como si formara
 * parte de la aplicación, se mantiene al cambiar un tipo, y aparece en cada
 * búsqueda. Esta prueba falla cuando vuelve a haber uno.
 *
 * Las excepciones tienen nombre y razón. Un barril publicado es una puerta
 * aunque hoy nadie entre por ella; los ficheros de arranque de Vitest y los
 * tipos generados los carga la herramienta, no un import.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, normalize } from 'node:path';
import { describe, expect, it } from 'vitest';

const ENTRIES = new Set(['index.tsx', 'App.tsx']);

/** Cargados por una herramienta o publicados como puerta, no importados. */
const KNOWN_UNIMPORTED = new Set([
  'vitest.setup.dom.ts',
  'vitest.setup.env.ts',
  'vitest.setup.node.ts',
  'supabase/database.types.ts',
  // Barriles publicados: puertas de su módulo o carpeta.
  'components/architectureOffice/index.ts',
  'hooks/artifacts/index.ts',
  'services/ai/providers/anthropic/index.ts',
  'services/ai/providers/gemini/index.ts',
]);

const tracked = (pattern: string): string[] =>
  execSync(`git ls-files ${pattern}`, { encoding: 'utf8' }).split('\n').filter(Boolean);

const isTest = (file: string): boolean =>
  file.startsWith('__tests__/') || file.includes('/__tests__/') || file.startsWith('e2e/');

const resolve = (from: string, spec: string): string | null => {
  const base = (spec.startsWith('@/') ? spec.slice(2) : normalize(join(dirname(from), spec)))
    .replace(/\.(?:js|mjs)$/, '');
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
};

const importedFiles = (): Set<string> => {
  const imported = new Set<string>();
  for (const file of tracked("'*.ts' '*.tsx' '*.mjs'")) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/(?:from|import\(|import)\s*['"]((?:\.|@\/)[^'"]+)['"]/g)) {
      const target = resolve(file, match[1]);
      if (target) imported.add(target);
    }
  }
  return imported;
};

describe('ficheros sin consumidor (F6-01)', () => {
  const imported = importedFiles();
  const candidates = tracked("'*.ts' '*.tsx'").filter((file) =>
    !isTest(file)
    && !file.endsWith('.d.ts')
    && !file.startsWith('api/')
    && !file.startsWith('scripts/')
    && !file.startsWith('supabase/functions/')
    && !/\.config\.ts$/.test(file)
    && !ENTRIES.has(file));

  it('todo fichero de código lo importa alguien, o tiene su excepción con nombre', () => {
    const orphans = candidates.filter((file) => !imported.has(file) && !KNOWN_UNIMPORTED.has(file));
    expect(orphans).toEqual([]);
  });

  it('las excepciones siguen existiendo y siguen sin importarse — la lista no acumula restos', () => {
    for (const file of KNOWN_UNIMPORTED) {
      expect(existsSync(file), `${file} ya no existe: quítalo de la lista`).toBe(true);
      expect(imported.has(file), `${file} ya se importa: quítalo de la lista`).toBe(false);
    }
  });

  it('ve el árbol que dice ver', () => {
    expect(candidates.length).toBeGreaterThan(500);
    expect(imported.has('services/ai/generation/artifacts/artifactGenerationEngine.ts')).toBe(true);
  });
});

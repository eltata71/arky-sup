/**
 * El dominio de Iniciativas es puro, y esto es lo que lo mantiene así (F3-05).
 *
 * «Las reglas se prueban sin React ni Supabase» es una propiedad que se pierde
 * en un solo import: basta con que alguien traiga `MirroredList` a un fichero de
 * `domain/` para ahorrarse un parámetro. El compilador no lo ve —un import es
 * válido—, así que se mira el código: cada fichero de `domain/` sólo puede
 * importar de `domain/`, de `lib/` o de `types.ts`, y ninguno toca el reloj ni
 * la red por su cuenta salvo donde está declarado.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, normalize, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOMAIN = 'services/businessInitiatives/domain';

const domainFiles = (): string[] => readdirSync(DOMAIN)
  .filter((name) => name.endsWith('.ts'))
  .map((name) => join(DOMAIN, name));

const importsOf = (file: string): string[] => {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)]
    .map((match) => match[1] ?? match[2]);
};

const resolved = (file: string, specifier: string): string =>
  specifier.startsWith('.') ? normalize(join(dirname(file), specifier)) : specifier;

describe('the initiatives domain', () => {
  it('has files to check — the scanner is not passing on an empty folder', () => {
    expect(domainFiles().length).toBeGreaterThanOrEqual(8);
  });

  it('imports only itself, `lib/` and the shared kernel', () => {
    const offending: string[] = [];
    for (const file of domainFiles()) {
      for (const specifier of importsOf(file)) {
        const target = resolved(file, specifier);
        const allowed = target.startsWith(`${DOMAIN}`)
          || target.startsWith('lib/')
          || target === 'types';
        if (!allowed) offending.push(`${file} → ${specifier}`);
      }
    }
    expect(offending).toEqual([]);
  });

  it('never names React, Supabase, the persistence layer or the adapters', () => {
    for (const file of domainFiles()) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from ['"]react['"]/);
      expect(source, file).not.toMatch(/@supabase\//);
      expect(source, file).not.toMatch(/\/persistence['"/]/);
      expect(source, file).not.toMatch(/\/adapters['"/]/);
    }
  });

  it('and the infrastructure is not reachable from a screen except through the module door', () => {
    // El repositorio y el adaptador viven en `infrastructure/`. Una pantalla
    // que los importe por ruta se salta la puerta del módulo; antes de F3-05
    // un panel lo hacía para acuñar ids.
    const screens = ['components', 'pages', 'hooks']
      .flatMap((root) => readdirSync(root, { recursive: true, encoding: 'utf8' })
        .filter((name) => /\.tsx?$/.test(name))
        .map((name) => join(root, name)));
    const offending = screens.filter((file) =>
      /businessInitiatives\/infrastructure/.test(readFileSync(file, 'utf8')));
    expect(offending).toEqual([]);
  });
});

/**
 * El dominio de cada contexto es puro — y esto lo comprueba para todos (F6-03).
 *
 * «Las reglas se prueban sin React ni Supabase» se pierde con un solo import:
 * basta con que alguien traiga la caché o el adaptador a un fichero de
 * `domain/` para ahorrarse un parámetro. El compilador no lo ve, porque un
 * import es válido. La primera versión de esta prueba (F3-05, Iniciativas)
 * miraba los imports directos contra una lista de carpetas permitidas. Ésta
 * sigue **el cierre de imports de valor**, así que un dominio puede leer el
 * vocabulario de otro contexto —sus tipos, y una función pura suya— sin poder
 * alcanzar, por ningún camino, nada que haga E/S.
 *
 * Los `import type` no cuentan: el compilador los borra y nunca ejecutan nada.
 *
 * `CONTEXTS` sólo crece: cada corte de F6-03 añade el contexto que ordena.
 */
import ts from 'typescript';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

/** Los contextos con la forma completa: `domain/` puro e `infrastructure/` aparte. */
const CONTEXTS = [
  'services/businessInitiatives',
  'services/architectureProjects',
  'services/architectureOffice',
] as const;

/** Lo que hace E/S, o pinta: nada de esto puede alcanzarse desde un dominio. */
const IO_PATHS = /^(services\/(adapters|persistence|observability|identity)\/|context\/|components\/|pages\/|hooks\/)/;
/** Paquetes que un dominio puede cargar: generar un id no es E/S. */
const ALLOWED_PACKAGES = new Set(['uuid']);

const filesUnder = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (statSync(path).isDirectory()) return filesUnder(path);
  return /\.tsx?$/.test(name) ? [path] : [];
});

const resolveLocal = (from: string, specifier: string): string | null => {
  const base = specifier.startsWith('@/') ? join(ROOT, specifier.slice(2)) : resolve(dirname(from), specifier);
  for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
    const candidate = base + suffix;
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
};

/** Los especificadores que ejecutan algo al cargarse: los `import type` fuera. */
const valueSpecifiers = (file: string): string[] => {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const onlyTypes = (elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>) =>
    elements.length > 0 && elements.every((element) => element.isTypeOnly);
  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly) return;
      if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)
        && onlyTypes(clause.namedBindings.elements)) return;
      out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      if (node.isTypeOnly) return;
      if (node.exportClause && ts.isNamedExports(node.exportClause) && onlyTypes(node.exportClause.elements)) return;
      out.push(node.moduleSpecifier.text);
    }
  });
  // Un `import('…')` que se ejecuta es una llamada; `import('…').Tipo` en
  // posición de tipo es un `ImportTypeNode`, que el compilador borra.
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      out.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
};

/** El cierre de valor del dominio: cada fichero alcanzable y cada paquete cargado. */
const closureOf = (context: string) => {
  const files = new Set<string>();
  const packages = new Set<string>();
  const parent = new Map<string, string>();
  const stack = filesUnder(join(ROOT, context, 'domain'));
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const specifier of valueSpecifiers(file)) {
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) {
        packages.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
        continue;
      }
      const target = resolveLocal(file, specifier);
      if (target && !files.has(target)) {
        parent.set(target, file);
        stack.push(target);
      }
    }
  }
  const chain = (file: string): string => {
    const links: string[] = [];
    for (let current: string | undefined = file; current; current = parent.get(current)) links.unshift(relative(ROOT, current));
    return links.join(' → ');
  };
  return { files, packages, chain };
};

describe.each(CONTEXTS)('el dominio de %s', (context) => {
  it('existe, con su infraestructura aparte', () => {
    expect(filesUnder(join(ROOT, context, 'domain')).length).toBeGreaterThanOrEqual(4);
    expect(existsSync(join(ROOT, context, 'infrastructure'))).toBe(true);
  });

  it('no alcanza por ningún camino nada que haga E/S o pinte', () => {
    const { files, chain } = closureOf(context);
    const offending = [...files]
      .map((file) => relative(ROOT, file))
      .filter((file) => IO_PATHS.test(file) || file.startsWith(`${context}/infrastructure/`));
    expect(offending.map((file) => chain(join(ROOT, file)))).toEqual([]);
  });

  it('sólo carga paquetes que no hacen E/S', () => {
    const { packages } = closureOf(context);
    expect([...packages].filter((name) => !ALLOWED_PACKAGES.has(name))).toEqual([]);
  });

  it('ni siquiera nombra React ni Supabase, ni como tipo', () => {
    for (const file of filesUnder(join(ROOT, context, 'domain'))) {
      const source = readFileSync(file, 'utf8');
      expect(source, file).not.toMatch(/from ['"]react['"]/);
      expect(source, file).not.toMatch(/@supabase\//);
    }
  });

  it('y ninguna pantalla importa su infraestructura por ruta', () => {
    const screens = ['components', 'pages', 'hooks']
      .flatMap((root) => filesUnder(join(ROOT, root)));
    const offending = screens
      .filter((file) => readFileSync(file, 'utf8').includes(`${context.split('/')[1]}/infrastructure`))
      .map((file) => relative(ROOT, file));
    expect(offending).toEqual([]);
  });
});

describe('la prueba misma', () => {
  it('detecta E/S alcanzada a través de otro fichero, no sólo la importada directamente', () => {
    // La infraestructura de Proyectos importa persistencia y adaptadores: si el
    // cierre partiera de ella, tendría que encontrarlos.
    const writes = join(ROOT, 'services/architectureProjects/infrastructure/projectWrites.ts');
    const reached = new Set<string>();
    const stack = [writes];
    while (stack.length > 0) {
      const file = stack.pop()!;
      if (reached.has(file)) continue;
      reached.add(file);
      for (const specifier of valueSpecifiers(file)) {
        if (!specifier.startsWith('.')) continue;
        const target = resolveLocal(file, specifier);
        if (target) stack.push(target);
      }
    }
    expect([...reached].some((file) => IO_PATHS.test(relative(ROOT, file)))).toBe(true);
  });
});

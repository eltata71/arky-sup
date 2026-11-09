/**
 * #264 M3: la crítica del revisor se declara, nunca se castea — sostenido por
 * el árbol de sintaxis, no por una expresión regular.
 *
 * El escáner anterior buscaba el texto `parseStructured<...>(` en un único
 * archivo: un `raw as ReviewCritique`, una aserción `<ReviewCritique>`, un
 * `JSON.parse` o una llamada por alias pasaban sin tocarlo, y
 * `officeConsolidationPort.ts` quedaba fuera. Aquí:
 *
 * 1. Los adaptadores del runner se descubren por AST —todo archivo de
 *    producción que llama a `invokePersona`, es decir, que recibe texto del
 *    modelo— y no pueden caer por debajo de un suelo conocido.
 * 2. En un adaptador no hay aserciones de tipo (salvo `as const`), ni `any`,
 *    ni directivas `@ts-*`, ni parsers crudos (`JSON`, `parseAiJson`), ni
 *    `parseStructured` con genérico distinto de `unknown` o usado por alias.
 * 3. Cada lectura se relaciona con su validación: el resultado de
 *    `parseStructured` se guarda en una constante cuyo `.value` sólo puede ir
 *    como argumento de un validador importado del contrato del dominio.
 * 4. En todo el código de producción, ninguna aserción, genérico de parser ni
 *    `JSON.parse` anotado produce un `ReviewCritique` fuera de su módulo —
 *    tampoco a través de alias de importación o de tipo.
 *
 * Cada regla tiene su mutante: si el escáner deja de verlo, el test cae.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SOURCE_ROOTS = ['api', 'components', 'context', 'hooks', 'lib', 'pages', 'services', 'utils'];
const CONTRACT_MODULE = 'services/architectureOffice/domain/reviewCritique';
const CONTRACT_TYPES = ['ReviewCritique', 'ReviewCritiqueFinding'];
/** Validador → módulo del que debe importarse. Uno local con el mismo nombre no cuenta. */
const VALIDATORS: Readonly<Record<string, string>> = { readReviewCritique: CONTRACT_MODULE };
const PARSER = 'parseStructured';
const RAW_PARSERS = new Set(['parseAiJson']);
const RESULT_FIELDS = new Set(['ok', 'error', 'repaired']);
const RUNNER_ADAPTERS = 'services/architectureOffice/infrastructure/OfficeRunnerAdapters.ts';
const ADAPTER_FLOOR = [RUNNER_ADAPTERS, 'services/architectureOffice/infrastructure/officeConsolidationPort.ts'];

type Rule =
  | 'cast' | 'any' | 'ts-directive' | 'parser-generic' | 'parser-alias' | 'raw-parser' | 'unvalidated-read'
  | 'contract-cast' | 'contract-generic' | 'contract-json';
interface Violation { file: string; line: number; rule: Rule; text: string }

const toPosix = (file: string) => file.split(sep).join('/');
const walkDir = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  if (name === '__tests__' || name === 'node_modules') return [];
  const file = join(dir, name);
  if (statSync(file).isDirectory()) return walkDir(file);
  return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts') ? [file] : [];
});
const productionFiles = (): Array<{ file: string; source: string }> => [
  ...SOURCE_ROOTS.flatMap((area) => walkDir(join(ROOT, area))),
  ...readdirSync(ROOT).filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.d.ts')).map((name) => join(ROOT, name)),
].map((file) => ({ file: toPosix(relative(ROOT, file)), source: readFileSync(file, 'utf8') }));

const parse = (file: string, source: string) =>
  ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const walk = (node: ts.Node, visit: (node: ts.Node) => void): void => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};
const at = (sf: ts.SourceFile, node: ts.Node, rule: Rule): Violation => ({
  file: sf.fileName,
  line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
  rule,
  text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 120),
});
const resolveModule = (file: string, specifier: string): string | null => specifier.startsWith('.')
  ? posix.normalize(posix.join(posix.dirname(file), specifier)).replace(/\.(tsx?|js)$/, '').replace(/\/index$/, '')
  : null;
const rightmost = (name: ts.EntityName): string => (ts.isIdentifier(name) ? name.text : name.right.text);

/** Nombre local → nombre importado y módulo resuelto (alias incluidos). */
const importsOf = (sf: ts.SourceFile) => {
  const imports = new Map<string, { imported: string; module: string | null }>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const module = resolveModule(sf.fileName, statement.moduleSpecifier.text);
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) imports.set(element.name.text, { imported: (element.propertyName ?? element.name).text, module });
    }
  }
  return imports;
};

/** ¿Nombra el tipo alguno de `names`, a cualquier profundidad (genéricos anidados, uniones, `import()`)? */
const mentions = (type: ts.Node, names: ReadonlySet<string>): boolean => {
  let found = false;
  walk(type, (node) => {
    if (ts.isTypeReferenceNode(node) && names.has(rightmost(node.typeName))) found = true;
    else if (ts.isImportTypeNode(node) && node.qualifier && names.has(rightmost(node.qualifier))) found = true;
    else if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression) && names.has(node.expression.text)) found = true;
  });
  return found;
};

/** Los nombres que en este archivo significan el contrato: alias de importación y de tipo, hasta punto fijo. */
const contractNamesIn = (sf: ts.SourceFile, seed: ReadonlySet<string>): Set<string> => {
  const names = new Set(seed);
  for (const [local, { imported }] of importsOf(sf)) if (names.has(imported)) names.add(local);
  for (let changed = true; changed;) {
    changed = false;
    walk(sf, (node) => {
      if ((ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) && !names.has(node.name.text) && mentions(node, names)) {
        names.add(node.name.text);
        changed = true;
      }
    });
  }
  return names;
};

/** Alias del contrato que un módulo exporta con otro nombre: se siguen entre archivos. */
const contractSeed = (files: ReadonlyArray<{ file: string; source: string }>): Set<string> => {
  const seed = new Set(CONTRACT_TYPES);
  for (let changed = true; changed;) {
    changed = false;
    for (const { file, source } of files) {
      if (![...seed].some((name) => source.includes(name))) continue;
      const sf = parse(file, source);
      const local = contractNamesIn(sf, seed);
      walk(sf, (node) => {
        const exported = ts.isExportSpecifier(node) && local.has((node.propertyName ?? node.name).text) ? node.name.text
          : (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node))
            && node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) && local.has(node.name.text)
            ? node.name.text : null;
        if (exported && !seed.has(exported)) { seed.add(exported); changed = true; }
      });
    }
  }
  return seed;
};

const calleeName = (callee: ts.Expression): string | null =>
  ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
const unwrap = (node: ts.Expression): ts.Expression => (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) ? unwrap(node.expression) : node);
const isJsonParse = (node: ts.Expression): boolean => {
  const call = unwrap(node);
  return ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression)
    && ts.isIdentifier(call.expression.expression) && call.expression.expression.text === 'JSON' && call.expression.name.text === 'parse';
};

/** Regla global: nadie fabrica un `ReviewCritique` por aserción, genérico de parser o `JSON.parse` anotado. */
function scanContractUse(file: string, source: string, seed: ReadonlySet<string> = new Set(CONTRACT_TYPES)): Violation[] {
  if (file === `${CONTRACT_MODULE}.ts` || ![...seed].some((name) => source.includes(name))) return [];
  const sf = parse(file, source);
  const names = contractNamesIn(sf, seed);
  const imports = importsOf(sf);
  // Un parser importado con alias se juzga por su nombre real (`ps` → `parseStructured`).
  const realName = (callee: ts.Expression): string => {
    const name = calleeName(callee) ?? '';
    return ts.isIdentifier(callee) ? imports.get(name)?.imported ?? name : name;
  };
  const out: Violation[] = [];
  walk(sf, (node) => {
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && mentions(node.type, names)) out.push(at(sf, node, 'contract-cast'));
    if (ts.isCallExpression(node) && node.typeArguments?.some((arg) => mentions(arg, names)) && /parse|json/i.test(realName(node.expression))) {
      out.push(at(sf, node, 'contract-generic'));
    }
    if (ts.isVariableDeclaration(node) && node.type && node.initializer && mentions(node.type, names) && isJsonParse(node.initializer)) {
      out.push(at(sf, node, 'contract-json'));
    }
  });
  return out;
}

/** Un adaptador del runner es todo archivo que llama a `invokePersona` -- también por un alias de
 * desestructuración (`const { invokePersona: invoke } = deps`), que el nombre textual por sí solo
 * no sigue (hallazgo M2, revisión de Rafael sobre de0839c3: un adaptador con ese alias quedaba
 * fuera del suelo conocido y `scanAdapter` nunca se ejecutaba sobre él). */
function isRunnerAdapter(file: string, source: string): boolean {
  if (!source.includes('invokePersona')) return false;
  const sf = parse(file, source);
  const localNames = new Set(['invokePersona']);
  walk(sf, (node) => {
    if (ts.isBindingElement(node) && node.propertyName && ts.isIdentifier(node.propertyName)
      && node.propertyName.text === 'invokePersona' && ts.isIdentifier(node.name)) {
      localNames.add(node.name.text);
    }
  });
  let calls = false;
  walk(sf, (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && localNames.has(name)) calls = true;
    }
  });
  return calls;
}

/** Reglas del adaptador: sin casts, sin parsers crudos, y cada lectura atada a su validador. */
function scanAdapter(file: string, source: string): { violations: Violation[]; validatedReads: number } {
  const sf = parse(file, source);
  const imports = importsOf(sf);
  const parserNames = new Set([PARSER, ...[...imports].filter(([, entry]) => entry.imported === PARSER).map(([local]) => local)]);
  const rawNames = new Set([...RAW_PARSERS, ...[...imports].filter(([, entry]) => RAW_PARSERS.has(entry.imported)).map(([local]) => local)]);
  const validators = new Set([...imports].filter(([, entry]) => VALIDATORS[entry.imported] !== undefined && VALIDATORS[entry.imported] === entry.module).map(([local]) => local));
  const out: Violation[] = [];
  let validatedReads = 0;

  for (const match of source.matchAll(/@ts-(ignore|expect-error|nocheck)/g)) {
    out.push({ file, line: sf.getLineAndCharacterOfPosition(match.index ?? 0).line + 1, rule: 'ts-directive', text: match[0] });
  }

  const isCallee = (id: ts.Identifier): boolean => {
    const parent = id.parent;
    if (ts.isImportSpecifier(parent)) return true;
    if (ts.isCallExpression(parent) && parent.expression === id) return true;
    return ts.isPropertyAccessExpression(parent) && parent.name === id && ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
  };

  // El resultado se guarda en una constante y su `.value` sólo viaja a un validador del contrato.
  const checkRead = (call: ts.CallExpression): void => {
    let node: ts.Node = call;
    while (ts.isParenthesizedExpression(node.parent)) node = node.parent;
    const declaration = node.parent;
    if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== node || !ts.isIdentifier(declaration.name)
      || !(declaration.parent.flags & ts.NodeFlags.Const)) {
      out.push(at(sf, call, 'unvalidated-read'));
      return;
    }
    const name = declaration.name.text;
    const scope = ts.findAncestor(declaration, (ancestor) => ts.isBlock(ancestor) || ts.isSourceFile(ancestor)) ?? sf;
    walk(scope, (ref) => {
      if (!ts.isIdentifier(ref) || ref.text !== name || ref === declaration.name) return;
      const parent = ref.parent;
      if ((ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === ref) return;
      if (ts.isPropertyAccessExpression(parent) && parent.expression === ref) {
        if (RESULT_FIELDS.has(parent.name.text)) return;
        const use = parent.parent;
        if (parent.name.text === 'value' && ts.isCallExpression(use) && use.arguments.includes(parent)
          && ts.isIdentifier(use.expression) && validators.has(use.expression.text)) {
          validatedReads += 1;
          return;
        }
      }
      out.push(at(sf, ref, 'unvalidated-read'));
    });
  };

  // Cierre explícito del mundo de fuentes legítimas (hallazgo M1, revisión de Rafael sobre
  // de0839c3): `checkRead` sólo vigilaba la constante que recibe `parseStructured(...)` directamente,
  // así que un helper con otro nombre (`decodeCritique`, con un `JSON.parse` propio) que asigna
  // directo a una variable ya tipada como el contrato se colaba entero -- ni cast, ni `any`, ni
  // parser conocido, ni lectura sin atar: ninguna regla existente lo nombraba. Cualquier variable
  // declarada con el tipo del contrato sólo puede recibir `null`/`undefined`, el `.value` de una
  // lectura ya atada a un validador (siguiendo la constante hasta su propia declaración), o la
  // llamada directa a un validador -- cualquier otra fuente es la misma fabricación sin validar.
  const contractNames = contractNamesIn(sf, new Set(CONTRACT_TYPES));
  const constDeclByName = new Map<string, ts.VariableDeclaration>();
  walk(sf, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (node.parent.flags & ts.NodeFlags.Const)) {
      constDeclByName.set(node.name.text, node);
    }
  });
  const isKnownValidatorCall = (expr: ts.Expression): boolean => {
    const u = unwrap(expr);
    return ts.isCallExpression(u) && ts.isIdentifier(u.expression) && validators.has(u.expression.text);
  };
  const isValidatedSource = (expr: ts.Expression): boolean => {
    const u = unwrap(expr);
    if (u.kind === ts.SyntaxKind.NullKeyword) return true;
    if (ts.isIdentifier(u) && u.text === 'undefined') return true;
    if (isKnownValidatorCall(u)) return true;
    if (ts.isPropertyAccessExpression(u) && u.name.text === 'value') {
      const base = u.expression;
      if (isKnownValidatorCall(base)) return true;
      if (ts.isIdentifier(base)) {
        const decl = constDeclByName.get(base.text);
        if (decl?.initializer && isKnownValidatorCall(decl.initializer)) return true;
      }
    }
    return false;
  };
  walk(sf, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.type || !mentions(node.type, contractNames)) return;
    const varName = node.name.text;
    const scope = ts.findAncestor(node, (ancestor) => ts.isBlock(ancestor) || ts.isSourceFile(ancestor)) ?? sf;
    walk(scope, (ref) => {
      if (!ts.isIdentifier(ref) || ref.text !== varName || ref === node.name) return;
      const parent = ref.parent;
      if (!ts.isBinaryExpression(parent) || parent.left !== ref || parent.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;
      if (!isValidatedSource(parent.right)) out.push(at(sf, parent, 'unvalidated-read'));
    });
  });

  walk(sf, (node) => {
    if ((ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))
      && !(ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === 'const')) {
      out.push(at(sf, node, 'cast'));
    }
    if (node.kind === ts.SyntaxKind.AnyKeyword) out.push(at(sf, node, 'any'));
    if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && parserNames.has(node.expression.text))
      || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === PARSER))) {
      const args = node.typeArguments;
      if (args && !(args.length === 1 && args[0].kind === ts.SyntaxKind.UnknownKeyword)) out.push(at(sf, node, 'parser-generic'));
      checkRead(node);
    }
    if (ts.isIdentifier(node) && parserNames.has(node.text) && !isCallee(node)) out.push(at(sf, node, 'parser-alias'));
    if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)
      && [PARSER, 'parse', ...RAW_PARSERS].includes(node.argumentExpression.text)) out.push(at(sf, node, 'parser-alias'));
    if (ts.isIdentifier(node) && rawNames.has(node.text)) out.push(at(sf, node, 'raw-parser'));
    // `JSON` sólo para escribir: cualquier otra referencia (también `const J = JSON`) es un parser crudo.
    if (ts.isIdentifier(node) && node.text === 'JSON'
      && !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node && node.parent.name.text === 'stringify')) {
      out.push(at(sf, node, 'raw-parser'));
    }
  });
  return { violations: out, validatedReads };
}

const rulesOf = (violations: Violation[]) => [...new Set(violations.map((violation) => violation.rule))].sort();
const replaceOnce = (source: string, from: string, to: string): string => {
  expect(source.split(from)).toHaveLength(2); // el ancla existe y es única: un mutante que no muta no prueba nada
  return source.replace(from, to);
};

const files = productionFiles();
const sourceOf = (file: string) => files.find((entry) => entry.file === file)!.source;
const adapters = files.filter(({ file, source }) => isRunnerAdapter(file, source));
const runnerSource = sourceOf(RUNNER_ADAPTERS);
const consolidationSource = sourceOf(ADAPTER_FLOOR[1]);
const READ = 'const reading = readReviewCritique(parsed.value);';
const mutantRules = (source: string, file = RUNNER_ADAPTERS) => rulesOf([...scanAdapter(file, source).violations, ...scanContractUse(file, source)]);

describe('lecturas del modelo en los adaptadores del runner (#264 M3)', () => {
  it('descubre los adaptadores por AST y no cae por debajo del suelo conocido', () => {
    const found = adapters.map(({ file }) => file);
    expect(found).toEqual(expect.arrayContaining(ADAPTER_FLOOR));
    // Quien define `invokePersona` no es un adaptador; quien lo llama, sí —también uno nuevo.
    expect(isRunnerAdapter('context/x.tsx', 'const deps = { invokePersona: async () => "" };')).toBe(false);
    expect(isRunnerAdapter('services/architectureOffice/infrastructure/newPort.ts', 'export const p = (d: D) => d.invokePersona("a", "b");')).toBe(true);
    // M2, revisión de Rafael: un alias por desestructuración del parámetro también cuenta.
    expect(isRunnerAdapter(
      'services/architectureOffice/infrastructure/aliasPort.ts',
      "export const p = (deps: D) => { const { invokePersona: invoke } = deps; return invoke('a', 'b'); };",
    )).toBe(true);
  });

  it('ningún adaptador real infringe las reglas, y el revisor se lee por su validador', () => {
    expect(adapters.flatMap(({ file, source }) => scanAdapter(file, source).violations)).toEqual([]);
    expect(scanAdapter(RUNNER_ADAPTERS, runnerSource).validatedReads).toBeGreaterThan(0);
  });

  it('el revisor se invoca con el esquema de su crítica declarado', () => {
    let declared = false;
    walk(parse(RUNNER_ADAPTERS, runnerSource), (node) => {
      if (ts.isCallExpression(node) && calleeName(node.expression) === 'invokePersona') {
        walk(node, (inner) => {
          if (ts.isPropertyAssignment(inner) && ts.isIdentifier(inner.name) && inner.name.text === 'responseSchema'
            && ts.isIdentifier(inner.initializer) && inner.initializer.text === 'REVIEW_CRITIQUE_SCHEMA') declared = true;
        });
      }
    });
    expect(declared).toBe(true);
  });

  it('ningún archivo de producción fabrica un ReviewCritique por cast, genérico o JSON.parse', () => {
    const seed = contractSeed(files);
    expect(files.flatMap(({ file, source }) => scanContractUse(file, source, seed))).toEqual([]);
  });

  describe('mutantes sobre el fuente real de OfficeRunnerAdapters.ts', () => {
    it.each<[string, () => string, Rule[]]>([
      ['cast `as` (el ejemplo del revisor)', () => replaceOnce(runnerSource, READ, `const bypass = raw as ReviewCritique;\n        ${READ}`), ['cast', 'contract-cast']],
      ['doble cast `as unknown as`', () => replaceOnce(runnerSource, READ, `critique = parsed.value as unknown as ReviewCritique;\n        ${READ}`), ['cast', 'contract-cast', 'unvalidated-read']],
      ['aserción de ángulo', () => replaceOnce(runnerSource, READ, `critique = <ReviewCritique>parsed.value;\n        ${READ}`), ['cast', 'contract-cast', 'unvalidated-read']],
      ['cast a `any`', () => replaceOnce(runnerSource, READ, `critique = (raw as any).critique;\n        ${READ}`), ['any', 'cast']],
      ['anotación `any` sin cast', () => replaceOnce(runnerSource, READ, `const loose: any = raw;\n        critique = loose;\n        ${READ}`), ['any']],
      ['genérico de contrato anidado', () => replaceOnce(runnerSource, 'parseStructured<unknown>(', 'parseStructured<Array<Partial<ReviewCritique>>>('), ['contract-generic', 'parser-generic']],
      ['genérico sin contrato', () => replaceOnce(runnerSource, 'parseStructured<unknown>(', 'parseStructured<Record<string, unknown>>('), ['parser-generic']],
      ['lectura sin validador', () => replaceOnce(runnerSource, READ, 'const reading = { value: parsed.value, discarded: [] };'), ['unvalidated-read']],
      ['validador falso local con el mismo nombre', () => replaceOnce(
        replaceOnce(runnerSource, "import { readReviewCritique, type ReviewCritique } from '../domain/reviewCritique';", "import type { ReviewCritique } from '../domain/reviewCritique';"),
        READ, `function readReviewCritique(value: unknown) { return { value: value as ReviewCritique, discarded: [] }; }\n        ${READ}`,
      ), ['cast', 'contract-cast', 'unvalidated-read']],
      ['desestructurar el resultado', () => replaceOnce(runnerSource, 'const parsed = parseStructured<unknown>(', 'const { value: parsedValue } = parseStructured<unknown>('), ['unvalidated-read']],
      ['resultado en `let` reasignable', () => replaceOnce(runnerSource, 'const parsed = parseStructured<unknown>(', 'let parsed = parseStructured<unknown>('), ['unvalidated-read']],
      ['`.value` directo sobre la llamada', () => replaceOnce(runnerSource, READ, `critique = readReviewCritique(parseStructured(String(raw)).value).value;\n        ${READ}`), ['unvalidated-read']],
      ['parser por alias local', () => replaceOnce(runnerSource, READ, `const read = parseStructured;\n        critique = read<ReviewCritique>('x').value ?? null;\n        ${READ}`), ['parser-alias']],
      ['parser por alias de importación', () => replaceOnce(
        replaceOnce(runnerSource, "import { parseStructured } from '../../ai/structuredOutput';", "import { parseStructured as ps } from '../../ai/structuredOutput';"),
        'parseStructured<unknown>(', 'ps<ReviewCritique>(',
      ), ['contract-generic', 'parser-generic']],
      ['parser por espacio de nombres', () => replaceOnce(runnerSource, READ, `critique = structuredOutput.parseStructured<ReviewCritique>(String(raw)).value ?? null;\n        ${READ}`), ['contract-generic', 'parser-generic', 'unvalidated-read']],
      ['parser por acceso dinámico', () => replaceOnce(runnerSource, READ, `const dynamic = structuredOutput['parseStructured'](String(raw));\n        ${READ}`), ['parser-alias']],
      ['`JSON.parse` directo', () => replaceOnce(runnerSource, READ, `critique = JSON.parse(String(raw));\n        ${READ}`), ['raw-parser']],
      ['`JSON` por alias', () => replaceOnce(runnerSource, READ, `const J = JSON;\n        critique = J.parse(String(raw));\n        ${READ}`), ['raw-parser']],
      ['`parseAiJson` importado con alias', () => replaceOnce(
        runnerSource, "import { parseStructured } from '../../ai/structuredOutput';",
        "import { parseStructured } from '../../ai/structuredOutput';\nimport { parseAiJson as pj } from '../../../lib/aiJson';\nvoid pj;",
      ), ['raw-parser']],
      ['directiva `@ts-expect-error`', () => replaceOnce(runnerSource, READ, `// @ts-expect-error\n        critique = parsed.value;\n        ${READ}`), ['ts-directive', 'unvalidated-read']],
      ['helper ajeno fabrica el contrato sin pasar por el validador (M1, revisión de Rafael)', () => replaceOnce(runnerSource, READ, `critique = decodeCritique(typeof raw === 'string' ? raw : raw.text);\n        ${READ}`), ['unvalidated-read']],
    ])('%s', (_name, mutant, rules) => {
      const mutated = mutant();
      expect(mutated).not.toBe(runnerSource);
      expect(mutantRules(mutated)).toEqual(expect.arrayContaining(rules));
    });
  });

  it('cubre officeConsolidationPort.ts: un cast o un parser crudo allí también cae', () => {
    const file = ADAPTER_FLOOR[1];
    expect(mutantRules(`${consolidationSource}\nexport const sneak = (raw: string) => raw as unknown as ReviewCritique;\n`, file)).toEqual(['cast', 'contract-cast']);
    expect(mutantRules(`${consolidationSource}\nexport const sneak = (raw: string) => parseStructured<ReviewCritique>(raw);\n`, file))
      .toEqual(['contract-generic', 'parser-generic', 'unvalidated-read']);
    expect(mutantRules(`${consolidationSource}\nexport const sneak = (raw: string): unknown => JSON.parse(raw);\n`, file)).toEqual(['raw-parser']);
  });

  it('fuera de los adaptadores: alias de tipo, `import()` y JSON.parse anotado tampoco fabrican el contrato', () => {
    const file = 'services/architectureOffice/application/rogue.ts';
    expect(rulesOf(scanContractUse(file, "import type { ReviewCritique as RC } from '../domain/reviewCritique';\nexport const c = (x: unknown) => x as RC;"))).toEqual(['contract-cast']);
    expect(rulesOf(scanContractUse(file, "import type { ReviewCritique } from '../domain/reviewCritique';\ntype Laundered = { inner: ReviewCritique };\nexport const c = (x: unknown) => <Laundered>x;"))).toEqual(['contract-cast']);
    expect(rulesOf(scanContractUse(file, "export const c = (x: unknown) => x as import('../domain/reviewCritique').ReviewCritiqueFinding[];"))).toEqual(['contract-cast']);
    expect(rulesOf(scanContractUse(file, "import type { ReviewCritique } from '../domain/reviewCritique';\nexport const c = (raw: string) => { const v: ReviewCritique = JSON.parse(raw); return v; };"))).toEqual(['contract-json']);
    // Un alias reexportado por otro módulo se sigue entre archivos.
    const seed = contractSeed([
      { file: 'services/a.ts', source: "export type { ReviewCritique as Verdict } from './architectureOffice/domain/reviewCritique';" },
      { file: 'services/b.ts', source: "import type { Verdict } from './a';\nexport const c = (x: unknown) => x as Verdict;" },
    ]);
    expect(rulesOf(scanContractUse('services/b.ts', "import type { Verdict } from './a';\nexport const c = (x: unknown) => x as Verdict;", seed))).toEqual(['contract-cast']);
    // El módulo del contrato y los usos legítimos (anotar, `useState<…>`) no son casts.
    expect(scanContractUse(`${CONTRACT_MODULE}.ts`, 'export const c = (x: unknown) => x as ReviewCritique;')).toEqual([]);
    expect(scanContractUse(file, 'let c: ReviewCritique | null = null; const [s] = useState<ReviewCritique | null>(null);')).toEqual([]);
  });
});

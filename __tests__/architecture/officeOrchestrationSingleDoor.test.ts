/** 16.3: production enters the orchestration engine only inside coordinateRequest. */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const OWNER = 'services/architectureOffice/application/officeCoordination.ts';
const ENGINE = 'executeOfficeOrchestration';
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  if (name === '__tests__' || name === 'node_modules') return [];
  const file = join(dir, name);
  return statSync(file).isDirectory() ? walk(file) : /\.tsx?$/.test(name) ? [file] : [];
});

function forbiddenCalls(source: string, file: string): number {
  if (!source.includes(ENGINE)) return 0;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names = new Set([ENGINE]);
  // An aliased import must not bypass the gate.
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === ENGINE) names.add(element.name.text);
      }
    }
  }
  let forbidden = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const call = node.expression;
      const isEngine = (ts.isIdentifier(call) && names.has(call.text))
        || (ts.isPropertyAccessExpression(call) && call.name.text === ENGINE)
        || (ts.isElementAccessExpression(call) && ts.isStringLiteral(call.argumentExpression) && call.argumentExpression.text === ENGINE);
      if (isEngine) {
        let parent: ts.Node | undefined = node.parent;
        while (parent && !(ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) && parent.name.text === 'coordinateRequest')) parent = parent.parent;
        if (file !== OWNER || !parent) forbidden += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return forbidden;
}

describe('executeOfficeOrchestration tiene una sola puerta de producción', () => {
  it('detecta llamadas directas, con alias, namespace y acceso dinámico', () => {
    for (const source of [
      'executeOfficeOrchestration(plan, invoke)',
      'import { executeOfficeOrchestration as run } from "./officeOrchestration"; run(plan, invoke)',
      'office.executeOfficeOrchestration(plan, invoke)',
      'office["executeOfficeOrchestration"](plan, invoke)',
    ]) expect(forbiddenCalls(source, 'services/rogue.ts')).toBe(1);
    expect(forbiddenCalls('const other = () => executeOfficeOrchestration(p, i)', OWNER)).toBe(1);
    expect(forbiddenCalls('const coordinateRequest = () => executeOfficeOrchestration(p, i)', OWNER)).toBe(0);
    expect(forbiddenCalls('// executeOfficeOrchestration(p, i)', 'docs.ts')).toBe(0);
  });

  it('sólo coordinateRequest llama al motor; tests y bancos pueden ejercitarlo directamente', () => {
    const files = [
      ...['services', 'components', 'pages', 'hooks', 'context', 'lib', 'utils', 'api'].flatMap((area) => walk(join(ROOT, area))),
      ...readdirSync(ROOT).filter((name) => /\.tsx?$/.test(name)).map((name) => join(ROOT, name)),
    ];
    expect(files.map((file) => ({ file: relative(ROOT, file), count: forbiddenCalls(readFileSync(file, 'utf8'), relative(ROOT, file)) }))
      .filter(({ count }) => count > 0)).toEqual([]);
  });
});

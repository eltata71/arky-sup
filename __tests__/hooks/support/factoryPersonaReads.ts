/**
 * Detector de lecturas del catálogo de personas de fábrica.
 *
 * Es AST y no regex: una expresión regular sólo veía el identificador pegado a
 * `[` o dentro de `Object.values/entries(...)`, y dejaba pasar
 * `OFFICE_AGENT_PERSONAS.elena.role`, la desestructuración, el espaciado y los
 * alias de importación (`import { OFFICE_AGENT_PERSONAS as P }`).
 *
 * Cuenta toda referencia al catálogo —o a un alias de importación suyo— salvo
 * las declaraciones de importación/reexportación y `Object.keys(...)`, que sólo
 * cuenta y no pinta nada configurable. Comentarios y cadenas no son referencias.
 */
import ts from 'typescript';

export const FACTORY_CATALOG = 'OFFICE_AGENT_PERSONAS';

const isObjectKeysArgument = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  return ts.isCallExpression(parent)
    && parent.arguments[0] === node
    && ts.isPropertyAccessExpression(parent.expression)
    && ts.isIdentifier(parent.expression.expression)
    && parent.expression.expression.text === 'Object'
    && parent.expression.name.text === 'keys';
};

const isPropertyName = (node: ts.Identifier): boolean => {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === node)
    || (ts.isPropertyAssignment(parent) && parent.name === node);
};

export const countFactoryPersonaReads = (code: string): number => {
  const source = ts.createSourceFile('scan.tsx', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set<string>([FACTORY_CATALOG]);
  for (const statement of source.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const spec of bindings.elements) {
      if ((spec.propertyName ?? spec.name).text === FACTORY_CATALOG) names.add(spec.name.text);
    }
  }

  let reads = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isIdentifier(node) && names.has(node.text) && !isPropertyName(node) && !isObjectKeysArgument(node)) {
      reads += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return reads;
};

/**
 * Detector de lecturas del catálogo de personas de fábrica.
 *
 * Es AST con resolución de símbolos, no regex: una expresión regular sólo veía
 * el identificador pegado a `[` o dentro de `Object.values/entries(...)`, y
 * dejaba pasar `OFFICE_AGENT_PERSONAS.elena.role`, la desestructuración, el
 * espaciado y los alias de importación (`import { OFFICE_AGENT_PERSONAS as P }`).
 *
 * Cuenta toda lectura de valor del catálogo, resuelta por el comprobador de
 * tipos sobre el propio fichero:
 *  - el identificador importado (con su alias), también como propiedad
 *    abreviada y en `export { P as X }` local, que lava el alias;
 *  - `NS.OFFICE_AGENT_PERSONAS` y `NS['OFFICE_AGENT_PERSONAS']` sobre un
 *    `import * as NS`.
 * No cuenta: declaraciones de importación/reexportación con origen, imports
 * `type`, posiciones de tipo (`typeof X`, `keyof typeof X`), nombres de miembro
 * homónimos (enum, método, atributo JSX, propiedad), identificadores que
 * sombrean el alias, comentarios y cadenas, ni `Object.keys(...)`, que sólo
 * cuenta y no pinta nada configurable.
 *
 * Falla cerrado: un fichero que no parsea, o con una extensión que no es
 * TypeScript, lanza error en vez de devolver 0. El modo (TS o TSX) sale de la
 * extensión: forzar TSX en un `.ts` lee mal `<T>(v) => v` y `<any>x`.
 * Límite declarado: un `import * as NS` usado como valor entero
 * (`const n = NS`) no se sigue.
 */
import ts from 'typescript';

export const FACTORY_CATALOG = 'OFFICE_AGENT_PERSONAS';

const scriptKindOf = (fileName: string): ts.ScriptKind => {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.(ts|mts|cts)$/i.test(fileName)) return ts.ScriptKind.TS;
  throw new Error(`factoryPersonaReads: extensión no soportada en «${fileName}» (sólo .ts/.tsx)`);
};

const isObjectKeysArgument = (node: ts.Node): boolean => {
  const parent = node.parent;
  return ts.isCallExpression(parent)
    && parent.arguments[0] === node
    && ts.isPropertyAccessExpression(parent.expression)
    && ts.isIdentifier(parent.expression.expression)
    && parent.expression.expression.text === 'Object'
    && parent.expression.name.text === 'keys';
};

const insideTypeQuery = (node: ts.Node): boolean => {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isTypeQueryNode(n)) return true;
    if (ts.isStatement(n)) return false;
  }
  return false;
};

const isTypeOnlyImport = (decl: ts.Declaration): boolean => {
  if (ts.isImportSpecifier(decl)) return decl.isTypeOnly || decl.parent.parent.isTypeOnly;
  if (ts.isNamespaceImport(decl)) return decl.parent.isTypeOnly;
  return false;
};

export const countFactoryPersonaReads = (code: string, fileName = 'scan.tsx'): number => {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [], allowJs: false };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === fileName ? source : undefined);
  host.fileExists = (name) => name === fileName;
  host.readFile = (name) => (name === fileName ? code : undefined);
  const program = ts.createProgram([fileName], options, host);

  const syntactic = program.getSyntacticDiagnostics(source);
  if (syntactic.length > 0) {
    const first = syntactic[0];
    const { line } = source.getLineAndCharacterOfPosition(first.start ?? 0);
    throw new Error(
      `factoryPersonaReads: «${fileName}» no parsea (línea ${line + 1}): ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}`,
    );
  }
  const checker = program.getTypeChecker();

  const declarationsOf = (symbol: ts.Symbol | undefined): readonly ts.Declaration[] => symbol?.declarations ?? [];
  const isCatalogImport = (symbol: ts.Symbol | undefined): boolean => declarationsOf(symbol).some(
    (d) => ts.isImportSpecifier(d) && !isTypeOnlyImport(d) && (d.propertyName ?? d.name).text === FACTORY_CATALOG,
  );
  const isNamespaceImport = (symbol: ts.Symbol | undefined): boolean => declarationsOf(symbol).some(
    (d) => ts.isNamespaceImport(d) && !isTypeOnlyImport(d),
  );

  let reads = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) return;
    if (ts.isExportDeclaration(node)) {
      // `export { P as X }` local lava el alias; `export … from` no lee nada.
      if (!node.moduleSpecifier && !node.isTypeOnly && node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const spec of node.exportClause.elements) {
          if (!spec.isTypeOnly && isCatalogImport(checker.getExportSpecifierLocalTargetSymbol(spec))) reads += 1;
        }
      }
      return;
    }
    if (ts.isIdentifier(node) && !insideTypeQuery(node)) {
      const parent = node.parent;
      if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
        if (isCatalogImport(checker.getShorthandAssignmentValueSymbol(parent))) reads += 1;
      } else if (isCatalogImport(checker.getSymbolAtLocation(node)) && !isObjectKeysArgument(node)) {
        reads += 1;
      } else if (isNamespaceImport(checker.getSymbolAtLocation(node))) {
        const isDot = ts.isPropertyAccessExpression(parent) && parent.expression === node
          && parent.name.text === FACTORY_CATALOG;
        const isBracket = ts.isElementAccessExpression(parent) && parent.expression === node
          && (ts.isStringLiteral(parent.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(parent.argumentExpression))
          && parent.argumentExpression.text === FACTORY_CATALOG;
        if ((isDot || isBracket) && !isObjectKeysArgument(parent)) reads += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return reads;
};

/**
 * R-16: the interface is bilingual, so a literal in JSX is a string that one
 * language cannot translate. This counts them — JSX text nodes and the
 * accessible/visible string attributes — under every React UI root.
 *
 * The budget is monotonic: it records today's count and may only fall. New
 * copy goes through `t()`; extracting a screen lowers the number in the same
 * change. `LITERAL_BUDGET` reaches 0 when no language option is left partially
 * translated.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Legacy regex includes 22 TypeScript syntax matches and the untranslated
// Arky Academy brand inside the printable certificate's HTML template.
const LITERAL_BUDGET = 23;
// The original regex misses JSX text next to expressions and multiline copy.
// This separate baseline records JSX text and visible string attributes via
// the syntax tree without weakening the original monotonic budget. Both must
// reach zero to close R-16.
const JSX_AST_LITERAL_BUDGET = 0;
const JSX_EXPRESSION_LITERAL_BUDGET = 0;
const CUSTOM_VISIBLE_PROP_BUDGET = 0;

const LEGACY_ROOTS = ['components', 'pages'];
const ROOTS = [...LEGACY_ROOTS, 'context', 'hooks'];
const TEXT_NODE = />\s*([^<>{}\n=]*[A-Za-zÁ-ÿ]{3,}[^<>{}\n=]*)</g;
const STRING_ATTR = /\b(?:aria-label|placeholder|title|alt|label)="([^"{}]*[A-Za-zÁ-ÿ]{3,}[^"{}]*)"/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

function countLiterals(): number {
  let total = 0;
  for (const root of LEGACY_ROOTS) {
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8');
      total += (text.match(TEXT_NODE)?.length ?? 0) + (text.match(STRING_ATTR)?.length ?? 0);
    }
  }
  return total;
}

function countJsxLiteralsInSource(source: ts.SourceFile): number {
  let total = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && /[A-Za-zÁ-ÿ]{3,}/.test(node.getText(source).trim())) total++;
    if (
      ts.isJsxAttribute(node)
      && ts.isIdentifier(node.name)
      && ['aria-label', 'placeholder', 'title', 'alt', 'label'].includes(node.name.text)
      && node.initializer
      && ts.isStringLiteral(node.initializer)
      && /[A-Za-zÁ-ÿ]{3,}/.test(node.initializer.text)
    ) total++;
    ts.forEachChild(node, visit);
  };
  visit(source);
  return total;
}

function countJsxLiterals(): number {
  let total = 0;
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      total += countJsxLiteralsInSource(source);
    }
  }
  return total;
}

function countVisibleExpressionsInSource(source: ts.SourceFile): number {
  let total = 0;
  const visibleAttributes = new Set(['aria-label', 'placeholder', 'title', 'alt', 'label']);
  const inspectExpression = (node: ts.Expression): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (/[A-Za-zÁ-ÿ]{3,}/.test(node.text) && !/^([a-z]+\.)+[a-z0-9-]+$/.test(node.text)) total++;
    } else if (ts.isTemplateExpression(node)) {
      const staticText = node.head.text + node.templateSpans.map(span => span.literal.text).join('');
      if (/[A-Za-zÁ-ÿ]{3,}/.test(staticText)) total++;
    } else if (ts.isConditionalExpression(node)) {
      inspectExpression(node.whenTrue);
      inspectExpression(node.whenFalse);
    } else if (ts.isParenthesizedExpression(node)) {
      inspectExpression(node.expression);
    } else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.PlusToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      inspectExpression(node.left);
      inspectExpression(node.right);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression) {
      const parent = node.parent;
      if (ts.isJsxElement(parent) || ts.isJsxFragment(parent) || ts.isJsxAttribute(parent) && ts.isIdentifier(parent.name) && visibleAttributes.has(parent.name.text)) {
        inspectExpression(node.expression);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return total;
}

function countVisibleExpressions(): number {
  let total = 0;
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      total += countVisibleExpressionsInSource(ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX));
    }
  }
  return total;
}

function countCustomVisibleProps(): number {
  let total = 0;
  for (const root of ROOTS) {
    for (const file of sources(root)) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node): void => {
        if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name)
          && !['aria-labelledby', 'titleId'].includes(node.name.text)
          && /(?:label|title|description|message|text|caption|tooltip|helper|hint|empty|loading|error)/i.test(node.name.text)
          && node.initializer && ts.isStringLiteral(node.initializer)
          && /[A-Za-zÁ-ÿ]{4,}/.test(node.initializer.text)
          && node.initializer.text !== 'middle') total++;
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  }
  return total;
}

describe('literal copy in JSX', () => {
  it('never rises above its recorded budget', () => {
    expect(countLiterals()).toBeLessThanOrEqual(LITERAL_BUDGET);
  });

  it('also keeps the JSX syntax-tree inventory monotonic', () => {
    expect(countJsxLiterals()).toBeLessThanOrEqual(JSX_AST_LITERAL_BUDGET);
  });

  it('keeps visible literals inside JSX expressions at zero', () => {
    expect(countVisibleExpressions()).toBeLessThanOrEqual(JSX_EXPRESSION_LITERAL_BUDGET);
  });

  it('keeps custom visible JSX props at zero', () => {
    expect(countCustomVisibleProps()).toBeLessThanOrEqual(CUSTOM_VISIBLE_PROP_BUDGET);
  });

  it('counts copy beside expressions and visible string attributes', () => {
    const source = ts.createSourceFile(
      'example.tsx',
      '<button aria-label="Abrir detalles">Antes {name} después</button>',
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    expect(countJsxLiteralsInSource(source)).toBe(3);
  });

  it('counts conditional and interpolated copy inside JSX expressions', () => {
    const source = ts.createSourceFile('example.tsx', '<span>{ready ? "Listo" : `Faltan ${count} tareas`}</span>', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect(countVisibleExpressionsInSource(source)).toBe(2);
  });
});

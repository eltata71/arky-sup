/**
 * The two languages say the same things.
 *
 * A key present in `en` and missing from `es` does not fail anything: the
 * lookup returns the key, so a Spanish user sees `docCreatedSuccess` in the
 * middle of a toast. That is the failure this file exists to catch, and it is
 * exactly the kind that survives review — nobody reads an 18 KB object literal
 * looking for a hole.
 *
 * The assertions below are on the *sets* rather than a fixed count, so adding
 * a pair of keys passes and adding one does not.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { en } from '../../../lib/i18n/locales/en';
import { es } from '../../../lib/i18n/locales/es';
import { UI_LANGUAGES, loadDictionary } from '../../../lib/i18n';

const translations = { en, es };

const LANGUAGES = ['en', 'es'] as const;

describe('loading', () => {
  it('declares exactly the languages that have a dictionary', () => {
    expect([...UI_LANGUAGES].sort()).toEqual(Object.keys(translations).sort());
  });

  it.each(LANGUAGES)('loads %s on demand', async (language) => {
    expect(await loadDictionary(language)).toBe(translations[language]);
  });
});

describe('the dictionary', () => {
  it('carries the two languages `Settings.language` can select', () => {
    expect(Object.keys(translations).sort()).toEqual([...LANGUAGES]);
  });

  it('defines the same keys in both', () => {
    const en = Object.keys(translations.en).sort();
    const es = Object.keys(translations.es).sort();
    expect(es).toEqual(en);
  });

  it.each(LANGUAGES)('leaves no %s entry blank', (language) => {
    const blanks = Object.entries(translations[language])
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    // A blank is worse than a missing key: the lookup treats `''` as falsy and
    // falls back to the key anyway, so it is a hole that looks filled.
    expect(blanks).toEqual([]);
  });

  it('keeps the same placeholders on both sides of a key', () => {
    const placeholders = (value: string) => (value.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort();
    for (const key of Object.keys(translations.en)) {
      expect(
        placeholders(translations.es[key]),
        `${key} does not substitute the same values in both languages`,
      ).toEqual(placeholders(translations.en[key]));
    }
  });

  it('defines every literal t() key used by interface code', () => {
    const missing: string[] = [];
    const files = (directory: string): string[] => readdirSync(directory).flatMap(name => {
      const file = join(directory, name);
      if (statSync(file).isDirectory()) return files(file);
      return /\.tsx?$/.test(name) ? [file] : [];
    });
    for (const root of ['components', 'pages', 'hooks', 'context']) {
      for (const file of files(root)) {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't'
            && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
            && !Object.hasOwn(translations.es, node.arguments[0].text)) {
            missing.push(`${file}: ${node.arguments[0].text}`);
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
    expect(missing).toEqual([]);
  });

  it('covers configuration labels displayed by screens', () => {
    const missing: string[] = [];
    const files = (directory: string): string[] => readdirSync(directory).flatMap(name => {
      const file = join(directory, name);
      if (statSync(file).isDirectory()) return files(file);
      return name.endsWith('.tsx') ? [file] : [];
    });
    const visibleProperty = new Set(['label', 'title', 'subtitle', 'description', 'hint', 'message', 'name', 'text']);
    for (const root of ['components', 'pages']) {
      for (const file of files(root)) {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
        const visit = (node: ts.Node): void => {
          if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && visibleProperty.has(node.name.text)
            && ts.isStringLiteral(node.initializer) && /[A-Za-zÁ-ÿ]{4}/.test(node.initializer.text)
            && !/^(?:text-|[a-z]+\.[a-z-]+$|RETRY$)/.test(node.initializer.text)
            && !Object.hasOwn(translations.es, node.initializer.text)) {
            missing.push(`${file}: ${node.initializer.text}`);
          }
          ts.forEachChild(node, visit);
        };
        visit(source);
      }
    }
    expect(missing).toEqual([]);
  });
});

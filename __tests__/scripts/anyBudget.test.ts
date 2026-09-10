/**
 * Specs for the `any` budget.
 *
 * The gate is only worth having if its count is right, and the first two
 * versions of this scanner were both wrong in ways that made it *pass*: a
 * recursive-glob pathspec skipped every file at the root of a directory —
 * including `services/geminiService.ts`, the largest holder of `any` in the
 * repository — and enumerating only tracked files let a brand-new module full
 * of them through until someone committed it. Both are pinned below.
 */

import { describe, expect, it } from 'vitest';
import { MAX_ANY_TOKENS, countAnyIn, scan, sourceFiles, stripCommentsAndStrings } from '../../scripts/countAnyTokens.mjs';

describe('what counts as an `any`', () => {
  it('counts the type positions', () => {
    expect(countAnyIn('const x: any = 1;')).toBe(1);
    expect(countAnyIn('const x = y as any;')).toBe(1);
    expect(countAnyIn('function f(a: any, b: any) {}')).toBe(2);
    expect(countAnyIn('const xs: any[] = [];')).toBe(1);
    expect(countAnyIn('type R = Record<string, any>;')).toBe(1);
    expect(countAnyIn('type U = string | any;')).toBe(1);
  });

  it('does not count the word where it is not a type', () => {
    // This is the whole difference between 39 and the 233 the audit reported.
    expect(countAnyIn('// any of these would work')).toBe(0);
    expect(countAnyIn('/* accepts any shape */')).toBe(0);
    expect(countAnyIn('const anyOf = schema.anyOf;')).toBe(0);
    expect(countAnyIn("const label = 'any';")).toBe(0);
    expect(countAnyIn('const prompt = `describe any risk`;')).toBe(0);
    expect(countAnyIn('const company = "Company";')).toBe(0);
  });

  it('strips comments and strings before counting', () => {
    const stripped = stripCommentsAndStrings("const s = 'x: any'; // y: any\nconst z: any = 1;");
    expect(countAnyIn(stripped)).toBe(1);
  });
});

describe('which files it looks at', () => {
  const files = sourceFiles();

  it('includes files at the root of a source directory', () => {
    // The regression: a recursive-glob pathspec matched only nested paths, so
    // the scanner reported 19 while the real figure was three times that.
    expect(files).toContain('services/geminiService.ts');
    expect(files).toContain('context/AppContext.tsx');
    expect(files).toContain('types.ts');
  });

  it('includes nested files too', () => {
    expect(files.some((file) => file.startsWith('services/ai/'))).toBe(true);
    expect(files.some((file) => file.startsWith('pages/LMS/'))).toBe(true);
  });

  it('excludes tests, which are held to a looser standard on purpose', () => {
    expect(files.some((file) => file.includes('__tests__/'))).toBe(false);
    expect(files.some((file) => /\.test\.tsx?$/.test(file))).toBe(false);
  });

  it('excludes declaration files, which have no statements to fix', () => {
    expect(files.some((file) => file.endsWith('.d.ts'))).toBe(false);
  });
});

describe('the budget itself', () => {
  it('is not exceeded', () => {
    const { total } = scan();
    expect(total).toBeLessThanOrEqual(MAX_ANY_TOKENS);
  });

  it('is kept at the measured figure, so it can only be tightened', () => {
    // Slack is not neutral: a budget above the real count silently permits new
    // `any` until it is used up. Whenever the count falls, the number moves
    // with it — that is what makes this monotonic.
    const { total } = scan();
    expect(MAX_ANY_TOKENS).toBe(total);
  });
});

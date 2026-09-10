/**
 * The strict boundary only grows.
 *
 * `strict: true` across the whole repository is not one change. With React's
 * types finally installed the codebase typechecks clean at its current
 * settings, but `strictNullChecks` alone still surfaces thousands of errors in
 * components written without it — a single flip is a months-long branch, which
 * is exactly why item 5 of the audit stayed open.
 *
 * So the boundary moves instead of the flag, and the thing worth protecting
 * mechanically is the direction of travel: a module can be added to
 * `tsconfig.strict.json`, and removing one to make a build pass is the failure
 * mode this asserts against.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const config = () => {
  // Line comments only. A block-comment strip would eat the `/**/` inside a
  // recursive glob like `lib/authz/**/*.ts` and report the entry as missing —
  // which it did, on the first run of this very test.
  const raw = readFileSync('tsconfig.strict.json', 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(raw) as { extends: string; compilerOptions: Record<string, unknown>; include: string[] };
};

/**
 * Every entry that has ever been inside the boundary.
 *
 * Adding to this list is the whole workflow; removing from it is the
 * regression. If a module genuinely has to leave — deleted, or merged
 * elsewhere — this list changes in the same commit, with the reason in the
 * message, rather than a config edit nobody reviews.
 */
const ADMITTED = [
  'env.d.ts',
  'lib/authz/**/*.ts',
  'lib/errorMessage.ts',
  'lib/ids.ts',
  'lib/richText/**/*.ts',
  'lib/security.ts',
  'lib/speechRecognition.ts',
  'lib/traceId.ts',
  'services/ai/aiProxyPolicy.ts',
];

describe('the boundary', () => {
  it('is genuinely strict, not strict in name', () => {
    const { compilerOptions } = config();
    expect(compilerOptions.strict).toBe(true);
    // The four `strict` does not imply, and the one that matters most for a
    // codebase that has been running without any of them.
    expect(compilerOptions.noUnusedLocals).toBe(true);
    expect(compilerOptions.noUnusedParameters).toBe(true);
    expect(compilerOptions.noImplicitReturns).toBe(true);
    expect(compilerOptions.noImplicitOverride).toBe(true);
  });

  it('extends the repository config rather than restating it', () => {
    // A second, independent compiler configuration would drift from the first
    // and start disagreeing about what the code even means.
    expect(config().extends).toBe('./tsconfig.json');
  });

  it('has not lost anything it once covered', () => {
    const { include } = config();
    for (const entry of ADMITTED) {
      expect(include, `${entry} left the strict boundary`).toContain(entry);
    }
  });

  it('covers the security-critical modules, which is where it should start', () => {
    const { include } = config();
    expect(include).toContain('lib/authz/**/*.ts');
    expect(include).toContain('lib/richText/**/*.ts');
    expect(include).toContain('lib/security.ts');
  });
});

describe('the repository-wide config still governs everything else', () => {
  it('has not been quietly relaxed to make the strict boundary look bigger', () => {
    const base = readFileSync('tsconfig.json', 'utf8');
    for (const flag of ['noImplicitThis', 'alwaysStrict', 'useUnknownInCatchVariables']) {
      expect(base, `${flag} disappeared from tsconfig.json`).toContain(flag);
    }
  });
});

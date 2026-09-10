/**
 * The presentation layers do not import an SDK.
 *
 * Firestore has been behind `firestoreService` for a long time and the model
 * providers behind `services/ai`. Auth was the exception: `AuthContext`
 * imported fifteen symbols from `firebase/auth` and made the calls itself.
 *
 * It broke no lint rule — `no-restricted-imports` covered `@google/genai` and
 * the legacy engine and never mentioned Firebase — so it was a convention
 * violation, which is the kind that survives review indefinitely. ESLint now
 * covers it; this asserts the same thing from the source tree, so the boundary
 * holds even if someone relaxes a rule or adds a directory the config misses.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const UI_LAYERS = ['components', 'pages', 'context', 'hooks'];

const sourceFiles = (): string[] =>
  execSync(`git ls-files --cached --others --exclude-standard ${UI_LAYERS.join(' ')}`)
    .toString()
    .split('\n')
    .filter(Boolean)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file));

/** Comments stripped: a note explaining the rule is not a violation of it. */
const readCode = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const importsFrom = (code: string, module: string): boolean =>
  new RegExp(`from\\s+['"]${module}['"]`).test(code);

describe('no Firebase SDK in the UI layers', () => {
  it.each(['firebase/auth', 'firebase/firestore', 'firebase/app'])('nothing imports %s', (module) => {
    const offenders = sourceFiles().filter((file) => importsFrom(readCode(file), module));
    expect(offenders, `Use services/identity/authService or services/firestoreService instead`).toEqual([]);
  });
});

describe('no model SDK in the UI layers', () => {
  it('nothing imports @google/genai', () => {
    const offenders = sourceFiles().filter((file) => importsFrom(readCode(file), '@google/genai'));
    expect(offenders).toEqual([]);
  });

  it('nothing imports the legacy engine', () => {
    const offenders = sourceFiles()
      .filter((file) => /from\s+['"][^'"]*geminiService['"]/.test(readCode(file)));
    expect(offenders, 'Use a domain façade from services/ai, or aiGateway').toEqual([]);
  });
});

describe('the adapters exist and are where the boundary points', () => {
  it('authService talks to the SDK so the context does not have to', () => {
    const source = readFileSync('services/identity/authService.ts', 'utf8');
    expect(source).toContain("from 'firebase/auth'");
  });

  it('AuthContext holds no SDK call of its own', () => {
    const code = readCode('context/AuthContext.tsx');
    expect(code).not.toContain('firebase/auth');
    // The SDK verbs, not just the import: a re-export elsewhere would let them
    // back in without the import line reappearing.
    for (const verb of ['signInWithPopup(', 'onAuthStateChanged(', 'updatePassword(', 'signInAnonymously(']) {
      expect(code, `${verb} belongs in services/identity/authService`).not.toContain(verb);
    }
  });
});

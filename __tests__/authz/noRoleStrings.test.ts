/**
 * Authorization is asked as a permission, never as a role string.
 *
 * The defect this closes was not a wrong comparison — it was fifteen *correct*
 * ones, each restating the policy in its own words. Because there was no single
 * definition, there was nothing for them to disagree with; they disagreed with
 * each other, and with `firestore.rules`, silently. Two concrete examples the
 * scan found:
 *
 *   - the Training Center let `['admin','superadmin','teacher']` see analytics,
 *     which had no way to express that a `reviewer` reads them too;
 *   - the ARB's own gate named `admin` and `superadmin`, excluding the one role
 *     whose entire purpose is governance.
 *
 * So the rule is mechanical: outside `lib/authz` and its tests, nothing in the
 * app compares an *authorization* role to a literal.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/** Every source file the scan covers, from git so it never drifts from the repo. */
const sourceFiles = (): string[] =>
  execSync('git ls-files "pages/*.tsx" "pages/**/*.tsx" "components/**/*.tsx" "context/*.tsx" "services/**/*.ts" "hooks/**/*.ts" "lib/**/*.ts"')
    .toString()
    .split('\n')
    .filter(Boolean)
    // `lib/authz` *is* the definition, and it is the one place these literals belong.
    .filter((file) => !file.startsWith('lib/authz/'));

/**
 * The file with comments stripped.
 *
 * The rule is about code, and a comment explaining why a role name must not be
 * compared would otherwise be reported as comparing it.
 */
const readCode = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * The auth roles, as literals. Deliberately not imported from `lib/authz`:
 * this scan must keep working if someone renames a role there, and what it
 * looks for is the *habit*, not the current vocabulary.
 */
const AUTH_ROLE_LITERALS = ['superadmin', 'teacher', 'student'];

/**
 * Files exempt with a reason. Each is an exception to the rule, not a hole in it.
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // The dev bypass mints a local admin identity; it is hard-disabled in PROD
  // builds and its role literal is the identity being minted, not a check.
  'context/AuthContext.tsx': 'dev bypass identity',
  // A diagram keyword table: "superadmin" here is a word that appears in a node
  // label and picks an icon. It is not a check about the current user.
  'components/NodeIcons.tsx': 'diagram icon keywords',
};

describe('no screen restates the access policy', () => {
  const files = sourceFiles();

  it('finds the source files to scan', () => {
    // A scan that silently matches nothing always passes.
    expect(files.length).toBeGreaterThan(200);
  });

  it('compares no authorization role to a literal', () => {
    const offenders: string[] = [];

    for (const file of files) {
      if (file in ALLOWED) continue;
      const source = readCode(file);

      for (const role of AUTH_ROLE_LITERALS) {
        // A *quoted* literal. An unquoted object key (`superadmin:` in a tint
        // table) is a presentation lookup over the role list, not a policy
        // restated — it cannot disagree with the matrix, it can only be
        // incomplete, and the type checker catches that.
        // `admin` alone is excluded on purpose: it appears in unrelated words,
        // and `superadmin` co-occurs with every real role check anyway.
        const pattern = new RegExp(`['"\`]${role}['"\`]`);
        if (pattern.test(source)) {
          offenders.push(`${file} → '${role}'`);
        }
      }
    }

    expect(offenders, 'usa literales de rol en lugar de can(...)').toEqual([]);
  });

  it('gates the administrative route, not only the screen behind it', () => {
    // The rail hides the entry point, but a URL typed by hand reaches the route
    // directly — and a screen that renders its shell before deciding has
    // already told the visitor what lives there.
    const app = readCode('App.tsx');
    expect(app).toMatch(/path="\/users"[^>]*permission="users:read"/);
  });

  it('leaves no legacy role name in the app surface', () => {
    // `student` and `teacher` are migrated on read by `parseAuthRole`. A file
    // that still writes them is creating records the new model has to keep
    // migrating forever.
    for (const file of files) {
      if (file in ALLOWED) continue;
      const source = readCode(file);
      expect(source, `${file} escribe un rol heredado`).not.toMatch(/role:\s*['"](student|teacher)['"]/);
    }
  });
});

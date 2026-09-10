/**
 * The rules and the client implement the same matrix, or this fails.
 *
 * D-4 was not "the rules are wrong". It was that the rules and the UI each held
 * a coherent, *different* idea of who is an administrator — the rules read a
 * custom claim nothing ever set, the UI read a Firestore document — and nothing
 * compared them. A model expressed twice in two languages cannot share one
 * definition; what it can have is a test that reads both and refuses to let them
 * drift.
 *
 * So this parses `firestore.rules` and checks each `@permission` function's role
 * list, cell by cell, against `ROLE_PERMISSIONS`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AUTH_ROLES,
  ROLE_PERMISSIONS,
  type AuthRole,
  type Permission,
} from '../../lib/authz';

const RULES = readFileSync('firestore.rules', 'utf8');

/**
 * Permissions the data layer deliberately does not enforce, each with the
 * reason. Listing them is the point: a new permission that nobody wired into
 * the rules shows up as an unexplained gap rather than as silence.
 */
const NOT_ENFORCED_IN_RULES: Readonly<Record<string, string>> = {
  // A transition of the engagement document, already covered by
  // `deliverable:write` on that document plus the `delivered` gate.
  'charter:approve': 'transición del documento de encargo',
  'deliverable:run': 'transición del documento de encargo',
  // Publication packages live on the artifact/engagement documents; the write
  // permission on those paths is what the rules check.
  'publication:publish': 'escritura sobre artefactos y encargos',
  // Reading analytics derives from course reads, which the rules do gate.
  'training:analytics': 'se deriva de la lectura de cursos',
  // Personal preferences under `settings/user_{uid}`, gated by ownership.
  'settings:manage': 'preferencias propias, controladas por propiedad',
};

/** Extract `@permission x` → the role list of the function beneath it. */
function parseRulesMatrix(): Map<string, AuthRole[]> {
  const found = new Map<string, AuthRole[]>();
  const pattern = /\/\/\s*@permission\s+([\w:-]+)\s*\n\s*function\s+\w+\(\)\s*\{\s*return\s+roleIn\(\[([^\]]*)\]\)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(RULES)) !== null) {
    const roles = match[2]
      .split(',')
      .map((entry) => entry.trim().replace(/^'|'$/g, ''))
      .filter(Boolean) as AuthRole[];
    found.set(match[1], roles);
  }
  return found;
}

const rulesMatrix = parseRulesMatrix();

describe('the rules file is parseable at all', () => {
  it('declares permission functions', () => {
    // A parser that silently matches nothing turns every check below green.
    expect(rulesMatrix.size).toBeGreaterThanOrEqual(13);
  });

  it('names only permissions the model declares', () => {
    for (const permission of rulesMatrix.keys()) {
      expect(
        Object.values(ROLE_PERMISSIONS).some((set) => set.has(permission as Permission)),
        `las reglas conceden un permiso inexistente: ${permission}`,
      ).toBe(true);
    }
  });
});

describe('every permission is either enforced or explicitly not', () => {
  const declared = new Set<string>();
  for (const set of Object.values(ROLE_PERMISSIONS)) {
    for (const permission of set) declared.add(permission);
  }

  it.each([...declared].sort())('%s', (permission) => {
    const enforced = rulesMatrix.has(permission);
    const excused = permission in NOT_ENFORCED_IN_RULES;
    expect(
      enforced || excused,
      `${permission} no está en firestore.rules ni en la lista de exclusiones razonadas`,
    ).toBe(true);
    // And never both — an excuse for something that is in fact enforced is a
    // stale comment that will outlive the reason for it.
    expect(enforced && excused, `${permission} está enforced y excusado a la vez`).toBe(false);
  });
});

describe('cell by cell, the rules agree with lib/authz', () => {
  it.each([...rulesMatrix.keys()].sort())('%s grants the same roles', (permission) => {
    const inRules = [...rulesMatrix.get(permission)!].sort();
    const inModel = AUTH_ROLES.filter((role) =>
      ROLE_PERMISSIONS[role].has(permission as Permission),
    ).sort();
    expect(inRules).toEqual([...inModel]);
  });

  it('names only roles the model knows', () => {
    for (const [permission, roles] of rulesMatrix) {
      for (const role of roles) {
        expect(AUTH_ROLES, `${permission} nombra un rol inexistente: ${role}`).toContain(role);
      }
    }
  });
});

describe('the structural invariants of the rewrite', () => {
  it('no longer decides administration from an unset custom claim alone', () => {
    // The original defect: `request.auth.token.role in ['admin','superadmin']`
    // with nothing in the codebase ever calling setCustomUserClaims.
    expect(RULES).not.toMatch(/request\.auth\.token\.role in \[/);
    // The claim is still honoured when a deployment sets one…
    expect(RULES).toContain("'role' in request.auth.token");
    // …and falls back to the document that the app actually writes.
    expect(RULES).toContain('documents/users/$(request.auth.uid)).data.role');
  });

  it('resolves the caller\'s role by the same precedence as the client', () => {
    // `resolveEffectiveRole` states the rule in TypeScript; `callerRole()`
    // states it in CEL. Neither can import the other, so the shapes are pinned
    // here: presence of the claim decides, the document is the fallback.
    expect(RULES).toMatch(/'role' in request\.auth\.token \? request\.auth\.token\.role : storedRole\(\)/);
    // And an unresolved session gets no role rather than a default one.
    expect(RULES).toMatch(/: ''/);
  });

  it('migrates the legacy names on read, exactly as parseAuthRole does', () => {
    expect(RULES).toContain("callerRole() == 'student' ? 'architect'");
    expect(RULES).toContain("callerRole() == 'teacher' ? 'trainer'");
  });

  it('does not let an identity author its own profile', () => {
    // `allow create: if signedIn() && request.auth.uid == uid` on `users/{uid}`
    // handed the entire access-control model to the caller.
    expect(RULES).not.toMatch(/allow create: if signedIn\(\) && request\.auth\.uid == uid/);
    expect(RULES).toContain('allow create: if canCreateUsers()');
  });

  it('validates the role on every write to a profile', () => {
    expect(RULES).toContain('isKnownRole(writtenRole())');
    expect(RULES).toContain('isPrivilegedRole(writtenRole()) || canGrantPrivileged()');
  });

  it('refuses a self-edit of one\'s own role', () => {
    // Two halves: the owner branch pins `role` to its current value, and the
    // administrator branch excludes their own row.
    expect(RULES).toContain('isOwner(uid) && request.resource.data.role == resource.data.role');
    expect(RULES).toMatch(/canUpdateUsers\(\)\s*\n\s*&& request\.auth\.uid != uid/);
  });

  it('gates the ARB on arb:decide rather than on administration', () => {
    // Signing off requires `arb:decide` and nothing else — in particular not
    // ownership, which is the whole separation of duties.
    expect(RULES).toContain("(request.resource.data.status == 'delivered' && canDecideArb())");
    // And every other transition is explicitly *not* the sign-off.
    expect(RULES).toContain("request.resource.data.status != 'delivered'");
    expect(RULES).toContain('allow create: if canDecideArb()');
  });

  it('never lets a bare signed-in session write portfolio records', () => {
    // A `viewer` is signed in, and used to be able to create projects and
    // initiatives simply by virtue of that.
    expect(RULES).not.toMatch(/allow create: if signedIn\(\)\s*\n\s*&& request\.resource\.data\.userId/);
  });

  it('keeps every immutable audit trail immutable', () => {
    const immutable = RULES.match(/allow update: if false;/g) ?? [];
    // reviewDecisions, agent_actions, arbDecisions.
    expect(immutable.length).toBeGreaterThanOrEqual(3);
  });
});

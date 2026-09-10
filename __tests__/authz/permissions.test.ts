/**
 * The access-control matrix, checked cell by cell.
 *
 * The published design is a table of roles against permissions. If that table
 * lives only in a document, the code drifts from it quietly — which is exactly
 * how `firestore.rules` and the UI ended up disagreeing about who is an
 * administrator. Encoding every cell here makes a disagreement a red test.
 *
 * The negative assertions matter more than the positive ones. "Reviewer can
 * approve" is the feature; "architect cannot approve" is the separation of
 * duties, and it is the one a refactor breaks silently.
 */

import { describe, expect, it } from 'vitest';
import {
  AUTH_ROLES,
  DEFAULT_PROVISIONED_ROLE,
  PERMISSION_LABELS,
  PRIVILEGED_ROLES,
  ROLE_PERMISSIONS,
  assignableRoles,
  can,
  canAll,
  canAny,
  canAssignRole,
  isAuthRole,
  parseAuthRole,
  permissionsFor,
  resolveEffectiveRole,
  roleOf,
  type AuthRole,
  type Permission,
} from '../../lib/authz';

const as = (role: string) => ({ role });

/**
 * The matrix, transcribed from the design independently of the implementation.
 * Written as "who holds it" per permission so a wrong cell reads as a wrong
 * list of roles rather than as a wrong boolean.
 */
const EXPECTED: Record<Permission, AuthRole[]> = {
  'portfolio:read': ['viewer', 'architect', 'reviewer', 'trainer', 'admin', 'superadmin'],
  'initiative:write': ['architect', 'reviewer', 'admin', 'superadmin'],
  'project:write': ['architect', 'reviewer', 'admin', 'superadmin'],
  'deliverable:write': ['architect', 'reviewer', 'admin', 'superadmin'],
  'deliverable:run': ['architect', 'reviewer', 'admin', 'superadmin'],
  'artifact:write': ['architect', 'reviewer', 'admin', 'superadmin'],
  'charter:approve': ['reviewer', 'admin', 'superadmin'],
  'arb:decide': ['reviewer', 'admin', 'superadmin'],
  'publication:publish': ['reviewer', 'admin', 'superadmin'],
  'training:consume': ['viewer', 'architect', 'reviewer', 'trainer', 'admin', 'superadmin'],
  'training:author': ['trainer', 'admin', 'superadmin'],
  'training:analytics': ['reviewer', 'trainer', 'admin', 'superadmin'],
  'users:read': ['admin', 'superadmin'],
  'users:create': ['admin', 'superadmin'],
  'users:update': ['admin', 'superadmin'],
  'users:delete': ['admin', 'superadmin'],
  'users:grant-privileged': ['superadmin'],
  'settings:manage': ['viewer', 'architect', 'reviewer', 'trainer', 'admin', 'superadmin'],
};

const ALL_PERMISSIONS = Object.keys(EXPECTED) as Permission[];

describe('the matrix is complete', () => {
  it('covers every permission the model declares', () => {
    // A matrix test that silently skips a permission proves nothing about it.
    expect(new Set(ALL_PERMISSIONS)).toEqual(new Set(Object.keys(PERMISSION_LABELS)));
  });

  it('gives every role a decided permission set', () => {
    // Adding a role without deciding what it can do must fail here rather than
    // resolve to "nothing" in production.
    for (const role of AUTH_ROLES) {
      expect(ROLE_PERMISSIONS[role], `rol sin permisos decididos: ${role}`).toBeDefined();
    }
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...AUTH_ROLES].sort());
  });

  it('labels every permission for the admin UI', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(PERMISSION_LABELS[permission]?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe.each(ALL_PERMISSIONS)('%s', (permission) => {
  const holders = EXPECTED[permission];

  it.each(holders)('is granted to %s', (role) => {
    expect(can(as(role), permission)).toBe(true);
  });

  const deniers = AUTH_ROLES.filter((role) => !holders.includes(role));
  if (deniers.length > 0) {
    it.each(deniers)('is denied to %s', (role) => {
      expect(can(as(role), permission)).toBe(false);
    });
  }
});

describe('separation of duties', () => {
  it('lets an architect produce a deliverable but not approve it', () => {
    expect(can(as('architect'), 'deliverable:write')).toBe(true);
    expect(can(as('architect'), 'deliverable:run')).toBe(true);
    // The whole point of the ARB: the author is not the approver.
    expect(can(as('architect'), 'charter:approve')).toBe(false);
    expect(can(as('architect'), 'arb:decide')).toBe(false);
    expect(can(as('architect'), 'publication:publish')).toBe(false);
  });

  it('keeps a trainer out of architecture authoring', () => {
    expect(can(as('trainer'), 'portfolio:read')).toBe(true);
    expect(can(as('trainer'), 'artifact:write')).toBe(false);
    expect(can(as('trainer'), 'project:write')).toBe(false);
  });

  it('keeps an architect out of course authoring', () => {
    expect(can(as('architect'), 'training:consume')).toBe(true);
    expect(can(as('architect'), 'training:author')).toBe(false);
  });

  it('keeps everyone but an administrator out of the user directory', () => {
    for (const role of ['viewer', 'architect', 'reviewer', 'trainer'] as AuthRole[]) {
      expect(can(as(role), 'users:read')).toBe(false);
      expect(can(as(role), 'users:create')).toBe(false);
    }
  });
});

describe('privilege cannot widen itself', () => {
  it('does not let an admin grant a privileged role', () => {
    // An administrator who can mint administrators can multiply, and past that
    // point no revocation is trustworthy.
    expect(can(as('admin'), 'users:grant-privileged')).toBe(false);
    expect(canAssignRole(as('admin'), 'admin')).toBe(false);
    expect(canAssignRole(as('admin'), 'superadmin')).toBe(false);
  });

  it('lets an admin assign every non-privileged role', () => {
    for (const role of ['viewer', 'architect', 'reviewer', 'trainer'] as AuthRole[]) {
      expect(canAssignRole(as('admin'), role)).toBe(true);
    }
  });

  it('lets a superadmin assign anything, including its own role', () => {
    for (const role of AUTH_ROLES) {
      expect(canAssignRole(as('superadmin'), role)).toBe(true);
    }
  });

  it('lets a non-administrator assign nothing at all', () => {
    for (const role of ['viewer', 'architect', 'reviewer', 'trainer'] as AuthRole[]) {
      expect(assignableRoles(as(role))).toEqual([]);
    }
  });

  it('marks exactly admin and superadmin as privileged', () => {
    expect([...PRIVILEGED_ROLES].sort()).toEqual(['admin', 'superadmin']);
  });
});

describe('failing closed', () => {
  it('denies everything to an absent bearer', () => {
    for (const permission of ALL_PERMISSIONS) {
      expect(can(null, permission)).toBe(false);
      expect(can(undefined, permission)).toBe(false);
      expect(can({}, permission)).toBe(false);
    }
  });

  it('denies everything to an unrecognised role', () => {
    // A profile that could not be read is not evidence of permission — and
    // treating it as the lowest role would still grant reads.
    for (const permission of ALL_PERMISSIONS) {
      expect(can(as('wizard'), permission)).toBe(false);
      expect(can(as(''), permission)).toBe(false);
    }
    expect(permissionsFor(null).size).toBe(0);
  });
});

describe('legacy role migration', () => {
  it('reads a stored `student` as an architect, preserving what they can do', () => {
    // Mapping to `viewer` would silently take away project and artifact
    // authoring, which a "student" already has today.
    expect(parseAuthRole('student')).toBe('architect');
    expect(can(as('student'), 'artifact:write')).toBe(true);
    expect(can(as('student'), 'project:write')).toBe(true);
  });

  it('reads a stored `teacher` as a trainer', () => {
    expect(parseAuthRole('teacher')).toBe('trainer');
    expect(can(as('teacher'), 'training:author')).toBe(true);
  });

  it('does not promote a legacy role into governance', () => {
    expect(can(as('student'), 'arb:decide')).toBe(false);
    expect(can(as('teacher'), 'users:read')).toBe(false);
  });

  it('migrates nobody into the two new roles', () => {
    // A role that appears on its own was chosen by no one.
    const migrated = ['student', 'teacher'].map(parseAuthRole);
    expect(migrated).not.toContain('viewer');
    expect(migrated).not.toContain('reviewer');
  });

  it('rejects an unknown stored value rather than guessing', () => {
    expect(parseAuthRole('root')).toBeNull();
    expect(parseAuthRole(undefined)).toBeNull();
    expect(parseAuthRole(42)).toBeNull();
    expect(isAuthRole('student')).toBe(false); // a legacy alias, not a current role
    expect(isAuthRole('architect')).toBe(true);
  });

  it('resolves the role of a bearer through the same migration', () => {
    expect(roleOf({ role: 'student' })).toBe('architect');
    expect(roleOf({ role: null })).toBeNull();
    expect(roleOf(null)).toBeNull();
  });
});

describe('composite queries', () => {
  it('canAll requires every permission', () => {
    expect(canAll(as('reviewer'), ['artifact:write', 'arb:decide'])).toBe(true);
    expect(canAll(as('architect'), ['artifact:write', 'arb:decide'])).toBe(false);
  });

  it('canAny requires only one', () => {
    expect(canAny(as('architect'), ['arb:decide', 'artifact:write'])).toBe(true);
    expect(canAny(as('viewer'), ['arb:decide', 'artifact:write'])).toBe(false);
  });
});

describe('the default provisioned role', () => {
  it('is the least capable one', () => {
    // An account that arrives with more reach than someone decided to give it
    // is a decision nobody made.
    expect(DEFAULT_PROVISIONED_ROLE).toBe('viewer');
    expect(can(as(DEFAULT_PROVISIONED_ROLE), 'artifact:write')).toBe(false);
    expect(can(as(DEFAULT_PROVISIONED_ROLE), 'users:read')).toBe(false);
    expect(can(as(DEFAULT_PROVISIONED_ROLE), 'portfolio:read')).toBe(true);
  });
});

describe('resolving the role a session operates with', () => {
  /**
   * One rule, mirrored by `callerRole()` in `firestore.rules`. D-4 was two
   * coherent halves reaching opposite conclusions with nothing comparing them,
   * so the precedence is stated once and asserted here.
   */
  it('uses the document when no claim is set', () => {
    expect(resolveEffectiveRole(undefined, 'admin')).toBe('admin');
    expect(resolveEffectiveRole(null, 'architect')).toBe('architect');
    expect(resolveEffectiveRole('', 'reviewer')).toBe('reviewer');
  });

  it('lets a claim decide when the deployment sets one', () => {
    expect(resolveEffectiveRole('superadmin', 'viewer')).toBe('superadmin');
    // Including downward: a claim that narrows is still the deployment speaking.
    expect(resolveEffectiveRole('viewer', 'superadmin')).toBe('viewer');
  });

  it('returns null for a claim that is present but unreadable', () => {
    // Deliberately *not* the document. Falling back there would let the client
    // quietly overrule a stale claim the rules still honour — the two halves
    // disagreeing again, in the case hardest to notice.
    expect(resolveEffectiveRole('wizard', 'admin')).toBeNull();
  });

  it('migrates a legacy name from either source', () => {
    expect(resolveEffectiveRole(undefined, 'student')).toBe('architect');
    expect(resolveEffectiveRole('teacher', 'viewer')).toBe('trainer');
  });

  it('returns null when neither source says anything', () => {
    expect(resolveEffectiveRole(undefined, undefined)).toBeNull();
    expect(resolveEffectiveRole(null, 'root')).toBeNull();
  });

  it('grants nothing for an unresolved session', () => {
    const role = resolveEffectiveRole(undefined, undefined);
    for (const permission of ALL_PERMISSIONS) {
      expect(can({ role }, permission)).toBe(false);
    }
  });
});

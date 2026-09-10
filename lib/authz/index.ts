/**
 * `lib/authz` — the access-control model.
 *
 * Ask `can(profile, permission)`. Do not compare role strings: the whole point
 * of this module is that the policy has one definition, and `firestore.rules`
 * implements the same one.
 */

export {
  AUTH_ROLES,
  DEFAULT_PROVISIONED_ROLE,
  PERMISSION_LABELS,
  PRIVILEGED_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
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
  type RoleBearer,
} from './permissions';

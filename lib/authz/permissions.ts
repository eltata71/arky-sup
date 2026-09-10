/**
 * The access-control model: what the product can do, and who may do it.
 *
 * Authorization used to be fifteen scattered comparisons of the shape
 * `profile?.role === 'admin'`. Each screen restated the policy in its own
 * words, so the policy had no single definition to disagree with — and the
 * server, which is the only layer that actually decides, disagreed with all of
 * them (see `firestore.rules`).
 *
 * Here the policy is *data*: a permission catalogue, a role list, and one
 * matrix binding them. A screen asks `can(profile, 'users:read')` and never
 * learns that a role called `admin` exists. That indirection is what lets the
 * rules and the UI be checked against the same table instead of against each
 * other's habits.
 *
 * ## This is still not the security boundary
 *
 * Everything here runs in the browser and can be edited by whoever is holding
 * it. Its job is to decide what to *show*, and to keep that decision honest and
 * in one place. What is *allowed* is decided by `firestore.rules`, which
 * implements this same matrix. A permission granted here and not there is a
 * broken feature; granted there and not here is a hole.
 */

/* ----------------------------------------------------------------- roles */

/**
 * The six roles, derived from the two things the product does — govern
 * architecture, and train architects — plus administering itself.
 *
 * The previous names (`student`, `teacher`) came from the Training Center and
 * described a classroom rather than a function: `student` was the default role
 * of everyone doing architecture work, and it could already create projects and
 * artifacts without restriction.
 */
export type AuthRole =
  /** Reads the portfolio, consumes training. Writes nothing. */
  | 'viewer'
  /** The working role: authors initiatives, attentions, deliverables, artifacts. */
  | 'architect'
  /** Architect, plus approving charters, deciding at the ARB and publishing. */
  | 'reviewer'
  /** Authors the Training Center and reads its analytics. */
  | 'trainer'
  /** Everything above, plus managing users — but not granting privilege. */
  | 'admin'
  /** Everything, including granting `admin` and `superadmin`. */
  | 'superadmin';

/** Every role, in ascending order of reach. Order is used by the admin UI. */
export const AUTH_ROLES: readonly AuthRole[] = [
  'viewer',
  'architect',
  'reviewer',
  'trainer',
  'admin',
  'superadmin',
] as const;

/** Roles that carry administrative reach and may never be self-assigned. */
export const PRIVILEGED_ROLES: ReadonlySet<AuthRole> = new Set<AuthRole>([
  'admin',
  'superadmin',
]);

/**
 * The role a newly provisioned account gets when the administrator does not
 * choose one. Deliberately the least capable: an account that arrives with
 * more reach than someone decided to give it is a decision nobody made.
 */
export const DEFAULT_PROVISIONED_ROLE: AuthRole = 'viewer';

/**
 * How each role is named to a person, and what it is for.
 *
 * The admin screen must never render a raw role identifier: `trainer` is a key
 * in this codebase, not a job title, and a directory that shows keys invites
 * the reader to guess what they mean.
 */
export const ROLE_LABELS: Readonly<Record<AuthRole, string>> = {
  viewer: 'Observador',
  architect: 'Arquitecto',
  reviewer: 'Revisor',
  trainer: 'Formador',
  admin: 'Administrador',
  superadmin: 'Superadministrador',
};

/** One line on what the role is for, shown beside the selector. */
export const ROLE_DESCRIPTIONS: Readonly<Record<AuthRole, string>> = {
  viewer: 'Consulta el portafolio y cursa formación. No escribe nada.',
  architect: 'Crea iniciativas, atenciones, entregables y artefactos.',
  reviewer: 'Arquitecto, y además aprueba charters, decide en el ARB y publica.',
  trainer: 'Crea y mantiene los cursos del Centro de Transformación.',
  admin: 'Todo lo anterior, y administra las cuentas del directorio.',
  superadmin: 'Todo, incluida la concesión de los roles administrativos.',
};

/* ----------------------------------------------------------- permissions */

/**
 * Everything the product can be asked to do, named for the act rather than for
 * the screen that performs it.
 */
export type Permission =
  // ---- Architecture Office
  | 'portfolio:read'
  | 'initiative:write'
  | 'project:write'
  | 'deliverable:write'
  | 'deliverable:run'
  | 'artifact:write'
  | 'charter:approve'
  | 'arb:decide'
  | 'publication:publish'
  // ---- Training Center
  | 'training:consume'
  | 'training:author'
  | 'training:analytics'
  // ---- Administration
  | 'users:read'
  | 'users:create'
  | 'users:update'
  | 'users:delete'
  | 'users:grant-privileged'
  | 'settings:manage';

/** Human-readable purpose of each permission, for the admin UI and for docs. */
export const PERMISSION_LABELS: Readonly<Record<Permission, string>> = {
  'portfolio:read': 'Ver iniciativas, atenciones, entregables y artefactos',
  'initiative:write': 'Crear y editar iniciativas de negocio',
  'project:write': 'Crear y editar atenciones de arquitectura',
  'deliverable:write': 'Crear y planificar entregables',
  'deliverable:run': 'Ejecutar el encargo y su DAG de tareas',
  'artifact:write': 'Crear, editar y versionar artefactos',
  'charter:approve': 'Aprobar el charter antes de ejecutar',
  'arb:decide': 'Decidir en el Comité de Revisión de Arquitectura',
  'publication:publish': 'Publicar un paquete gobernado',
  'training:consume': 'Cursar, tomar notas y obtener certificados',
  'training:author': 'Crear, editar y retirar cursos',
  'training:analytics': 'Ver la analítica de aprendizaje',
  'users:read': 'Ver el directorio de usuarios',
  'users:create': 'Dar de alta una cuenta',
  'users:update': 'Cambiar el rol o el estado de otra cuenta',
  'users:delete': 'Eliminar una cuenta',
  'users:grant-privileged': 'Conceder los roles admin o superadmin',
  'settings:manage': 'Configurar el proveedor de IA y las preferencias',
};

/* --------------------------------------------------------------- matrix */

const ARCHITECTURE_AUTHOR: readonly Permission[] = [
  'initiative:write',
  'project:write',
  'deliverable:write',
  'deliverable:run',
  'artifact:write',
];

const GOVERNANCE: readonly Permission[] = [
  'charter:approve',
  'arb:decide',
  'publication:publish',
];

const USER_ADMIN: readonly Permission[] = [
  'users:read',
  'users:create',
  'users:update',
  'users:delete',
];

/**
 * The matrix. This is the specification, not a convenience — the Firestore
 * rules implement the same table, and `__tests__/authz` checks every cell.
 *
 * Two decisions worth stating rather than inferring:
 *
 *   - **`admin` cannot grant `admin`.** An administrator who can mint
 *     administrators can multiply, and past that point no revocation is
 *     trustworthy. `users:grant-privileged` belongs to `superadmin` alone.
 *   - **`settings:manage` is universal** because today it covers personal
 *     preferences — theme, language, model and the user's own API key. If it
 *     ever covers deployment-wide configuration it has to split in two; noted
 *     here so that is a decision rather than a discovery.
 */
export const ROLE_PERMISSIONS: Readonly<Record<AuthRole, ReadonlySet<Permission>>> = {
  viewer: new Set<Permission>([
    'portfolio:read',
    'training:consume',
    'settings:manage',
  ]),

  architect: new Set<Permission>([
    'portfolio:read',
    ...ARCHITECTURE_AUTHOR,
    'training:consume',
    'settings:manage',
  ]),

  reviewer: new Set<Permission>([
    'portfolio:read',
    ...ARCHITECTURE_AUTHOR,
    ...GOVERNANCE,
    'training:consume',
    'training:analytics',
    'settings:manage',
  ]),

  trainer: new Set<Permission>([
    'portfolio:read',
    'training:consume',
    'training:author',
    'training:analytics',
    'settings:manage',
  ]),

  admin: new Set<Permission>([
    'portfolio:read',
    ...ARCHITECTURE_AUTHOR,
    ...GOVERNANCE,
    'training:consume',
    'training:author',
    'training:analytics',
    ...USER_ADMIN,
    'settings:manage',
  ]),

  superadmin: new Set<Permission>([
    'portfolio:read',
    ...ARCHITECTURE_AUTHOR,
    ...GOVERNANCE,
    'training:consume',
    'training:author',
    'training:analytics',
    ...USER_ADMIN,
    'users:grant-privileged',
    'settings:manage',
  ]),
};

/* ------------------------------------------------------------ migration */

/**
 * Names that predate this model, mapped so nobody loses access.
 *
 * `student` becomes `architect` rather than `viewer` on purpose: today a
 * "student" creates projects and artifacts without restriction, so mapping to
 * `viewer` would silently take away what they already do. The migration is a
 * rename of what someone can already do, never a change to it.
 *
 * `viewer` and `reviewer` are new and nobody is migrated into them — a role
 * that appears on its own was chosen by no one.
 */
const LEGACY_ROLE_ALIASES: Readonly<Record<string, AuthRole>> = {
  student: 'architect',
  teacher: 'trainer',
};

/** True when `value` is one of the current roles. */
export function isAuthRole(value: unknown): value is AuthRole {
  return typeof value === 'string' && (AUTH_ROLES as readonly string[]).includes(value);
}

/**
 * Read a role from arbitrary stored input, migrating a legacy name in memory.
 *
 * Returns `null` for anything unrecognised rather than guessing. A record whose
 * role cannot be read is not a viewer by accident — the caller decides what to
 * do with an unreadable profile, and that decision belongs where the context is.
 */
export function parseAuthRole(value: unknown): AuthRole | null {
  if (isAuthRole(value)) return value;
  if (typeof value === 'string' && value in LEGACY_ROLE_ALIASES) {
    return LEGACY_ROLE_ALIASES[value];
  }
  return null;
}

/**
 * Resolve the role a session actually operates with.
 *
 * This is the rule that D-4 was about. The Firestore rules used to read a
 * custom claim that nothing ever set, while the client read the user document —
 * two coherent halves reaching opposite conclusions, with nothing comparing
 * them. There is now one rule, stated here and mirrored by `callerRole()` in
 * `firestore.rules`:
 *
 *   **A claim, when the deployment sets one, decides. Otherwise the document
 *   does.**
 *
 * The sharp edge is deliberate: when a claim is *present but unreadable* the
 * answer is `null`, not the document's role. Falling back there would let the
 * client quietly overrule a stale claim that the rules still honour — and the
 * two halves would be disagreeing again, in the one case hardest to notice.
 */
export function resolveEffectiveRole(
  claimRole: unknown,
  storedRole: unknown,
): AuthRole | null {
  const claimPresent =
    claimRole !== undefined && claimRole !== null && claimRole !== '';
  return claimPresent ? parseAuthRole(claimRole) : parseAuthRole(storedRole);
}

/* --------------------------------------------------------------- queries */

/** Anything carrying a role — a user profile, a token claim, a test double. */
export interface RoleBearer {
  role?: string | null;
}

/** Resolve the effective role of a bearer, or `null` when it has none. */
export function roleOf(bearer: RoleBearer | null | undefined): AuthRole | null {
  return parseAuthRole(bearer?.role);
}

/** Every permission a role carries. Empty for an unknown role. */
export function permissionsFor(role: AuthRole | null | undefined): ReadonlySet<Permission> {
  if (!role) return new Set<Permission>();
  return ROLE_PERMISSIONS[role] ?? new Set<Permission>();
}

/**
 * The one question the rest of the app asks.
 *
 * Absent or unreadable bearers answer `false` for everything. Failing closed is
 * the only safe default: a profile that could not be loaded is not evidence of
 * permission, and treating it as the lowest role would still grant reads.
 */
export function can(
  bearer: RoleBearer | null | undefined,
  permission: Permission,
): boolean {
  return permissionsFor(roleOf(bearer)).has(permission);
}

/** True when the bearer holds every listed permission. */
export function canAll(
  bearer: RoleBearer | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.every((permission) => can(bearer, permission));
}

/** True when the bearer holds at least one of the listed permissions. */
export function canAny(
  bearer: RoleBearer | null | undefined,
  permissions: readonly Permission[],
): boolean {
  return permissions.some((permission) => can(bearer, permission));
}

/**
 * Roles this bearer may assign to someone else.
 *
 * An administrator may staff the product but not widen the circle that can
 * administer it; only a superadmin may grant a privileged role. A bearer who
 * cannot manage users at all assigns nothing.
 */
export function assignableRoles(bearer: RoleBearer | null | undefined): readonly AuthRole[] {
  if (!can(bearer, 'users:update') && !can(bearer, 'users:create')) return [];
  if (can(bearer, 'users:grant-privileged')) return AUTH_ROLES;
  return AUTH_ROLES.filter((role) => !PRIVILEGED_ROLES.has(role));
}

/** True when this bearer may assign this specific role. */
export function canAssignRole(
  bearer: RoleBearer | null | undefined,
  role: AuthRole,
): boolean {
  return assignableRoles(bearer).includes(role);
}

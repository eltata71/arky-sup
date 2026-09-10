/**
 * Runtime validation for the publication pipeline (Task 17).
 *
 * Publication packages are persisted on `Project.publicationPackages` and
 * rehydrated from Firestore / localStorage — i.e. they arrive from outside the
 * type system. These validators catch obvious corruption, drop unrecoverable
 * elements (without poisoning the rest), apply safe defaults and keep legacy
 * projects working. Every function is total — it never throws.
 */

import {
  PUBLICATION_SCHEMA_VERSION,
  type PublicationActor,
  type PublicationArtifactRef,
  type PublicationAuditEntry,
  type PublicationPackage,
  type PublicationPackageStatus,
} from './PublicationPipelineTypes';

export interface PublicationValidationIssue {
  path: string;
  message: string;
}

export interface PublicationValidationResult<T> {
  value: T | null;
  issues: PublicationValidationIssue[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const num = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const VALID_STATUSES: ReadonlySet<PublicationPackageStatus> = new Set([
  'draft', 'ready-for-review', 'changes-requested', 'approved', 'published', 'archived', 'blocked',
]);

const sanitizeActor = (input: unknown): PublicationActor | undefined => {
  if (!isObject(input)) return undefined;
  if (!isNonEmptyString(input.id) || !isNonEmptyString(input.name)) return undefined;
  return {
    id: input.id,
    name: input.name,
    ...(isNonEmptyString(input.role) ? { role: input.role } : {}),
  };
};

const sanitizeArtifactRef = (input: unknown): PublicationArtifactRef | null => {
  if (!isObject(input)) return null;
  if (!isNonEmptyString(input.artifactId) || !isNonEmptyString(input.type)) return null;
  return {
    artifactId: input.artifactId,
    versionGroupId: str(input.versionGroupId, input.artifactId),
    version: Math.max(1, Math.round(num(input.version, 1))),
    name: str(input.name, 'Artefacto'),
    type: input.type as PublicationArtifactRef['type'],
    ...(typeof input.compilerTier === 'string' ? { compilerTier: input.compilerTier } : {}),
    ...(typeof input.compilerScore === 'number' ? { compilerScore: input.compilerScore } : {}),
  };
};

const sanitizeAuditEntry = (input: unknown, packageId: string): PublicationAuditEntry | null => {
  if (!isObject(input)) return null;
  if (!isNonEmptyString(input.id) || !isNonEmptyString(input.action)) return null;
  const actor = sanitizeActor(input.actor) ?? { id: 'system', name: 'Sistema', role: 'system' };
  return {
    id: input.id,
    packageId: str(input.packageId, packageId),
    ...(isNonEmptyString(input.artifactId) ? { artifactId: input.artifactId } : {}),
    action: input.action as PublicationAuditEntry['action'],
    actor,
    timestamp: str(input.timestamp, new Date().toISOString()),
    details: str(input.details, ''),
    ...(typeof input.before === 'string' ? { before: input.before } : {}),
    ...(typeof input.after === 'string' ? { after: input.after } : {}),
  };
};

/**
 * Validate a single publication package. Returns the package with safe
 * defaults applied, or `null` when the envelope is unrecoverable.
 */
export const validatePublicationPackage = (
  input: unknown,
  pathPrefix = 'publicationPackage',
): PublicationValidationResult<PublicationPackage> => {
  const issues: PublicationValidationIssue[] = [];

  if (!isObject(input)) {
    return { value: null, issues: [{ path: pathPrefix, message: 'No es un objeto' }] };
  }
  if (!isNonEmptyString(input.id)) {
    return { value: null, issues: [{ path: `${pathPrefix}.id`, message: 'id ausente o vacío' }] };
  }
  if (!isNonEmptyString(input.projectId)) {
    return { value: null, issues: [{ path: `${pathPrefix}.projectId`, message: 'projectId ausente' }] };
  }
  if (!isNonEmptyString(input.profileId)) {
    issues.push({ path: `${pathPrefix}.profileId`, message: 'profileId ausente; se aplicará el perfil ejecutivo' });
  }

  const rawRefs = Array.isArray(input.artifactRefs) ? input.artifactRefs : [];
  const artifactRefs: PublicationArtifactRef[] = [];
  rawRefs.forEach((rawRef, index) => {
    const ref = sanitizeArtifactRef(rawRef);
    if (ref) artifactRefs.push(ref);
    else issues.push({ path: `${pathPrefix}.artifactRefs[${index}]`, message: 'referencia de artefacto corrupta descartada' });
  });

  const rawAudit = Array.isArray(input.auditTrail) ? input.auditTrail : [];
  const auditTrail: PublicationAuditEntry[] = [];
  rawAudit.forEach((rawEntry, index) => {
    const entry = sanitizeAuditEntry(rawEntry, input.id as string);
    if (entry) auditTrail.push(entry);
    else issues.push({ path: `${pathPrefix}.auditTrail[${index}]`, message: 'entrada de auditoría corrupta descartada' });
  });

  const status: PublicationPackageStatus = VALID_STATUSES.has(input.status as PublicationPackageStatus)
    ? (input.status as PublicationPackageStatus)
    : 'draft';

  const freshness = input.freshness === 'stale' || input.freshness === 'outdated' ? input.freshness : 'current';

  const safe: PublicationPackage = {
    id: input.id,
    schemaVersion: Math.max(1, Math.round(num(input.schemaVersion, PUBLICATION_SCHEMA_VERSION))),
    projectId: input.projectId,
    name: str(input.name, 'Paquete de publicación'),
    description: str(input.description, ''),
    profileId: isNonEmptyString(input.profileId) ? input.profileId : 'executive-architecture-brief',
    artifactRefs,
    status,
    version: Math.max(1, Math.round(num(input.version, 1))),
    freshness,
    createdAt: str(input.createdAt, new Date().toISOString()),
    updatedAt: str(input.updatedAt, new Date().toISOString()),
    auditTrail,
  };

  const createdBy = sanitizeActor(input.createdBy);
  if (createdBy) safe.createdBy = createdBy;
  const approvedBy = sanitizeActor(input.approvedBy);
  if (approvedBy) safe.approvedBy = approvedBy;
  if (isNonEmptyString(input.approvedAt)) safe.approvedAt = input.approvedAt;
  if (isNonEmptyString(input.publishedAt)) safe.publishedAt = input.publishedAt;

  // Heavy nested blocks (branding, quality, accessibility, traceability,
  // manifest) are recomputed by the pipeline; they are preserved as-is when
  // present and well-formed, and silently dropped when corrupt.
  if (isObject(input.branding)) safe.branding = input.branding as unknown as PublicationPackage['branding'];
  if (isObject(input.quality)) safe.quality = input.quality as unknown as PublicationPackage['quality'];
  if (isObject(input.accessibility)) safe.accessibility = input.accessibility as unknown as PublicationPackage['accessibility'];
  if (isObject(input.traceability)) safe.traceability = input.traceability as unknown as PublicationPackage['traceability'];
  if (isObject(input.manifest)) safe.manifest = input.manifest as unknown as PublicationPackage['manifest'];

  return { value: safe, issues };
};

/**
 * Validate a list of publication packages. Drops unrecoverable packages while
 * preserving every valid one, so a single corrupt package never blocks a
 * project from loading.
 */
export const validatePublicationPackages = (
  input: unknown,
): PublicationValidationResult<PublicationPackage[]> => {
  const issues: PublicationValidationIssue[] = [];
  if (!Array.isArray(input)) {
    return { value: [], issues };
  }
  const packages: PublicationPackage[] = [];
  input.forEach((raw, index) => {
    const result = validatePublicationPackage(raw, `publicationPackages[${index}]`);
    issues.push(...result.issues);
    if (result.value) packages.push(result.value);
  });
  return { value: packages, issues };
};

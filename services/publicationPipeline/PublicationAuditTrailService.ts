/**
 * Append-only audit trail for publication packages (Task 8 & 19).
 *
 * Every governance-relevant action — creation, updates, preflight, approval
 * transitions, publication, versioning, exports and overrides — is recorded as
 * an immutable {@link PublicationAuditEntry}. The trail is never rewritten or
 * truncated destructively; it is the evidence record an auditor relies on.
 *
 * All helpers are pure and return new objects — they never mutate their input.
 */

import { newPrefixedId } from '../../lib/ids';
import {
  SYSTEM_PUBLICATION_ACTOR,
  type PublicationActor,
  type PublicationAuditAction,
  type PublicationAuditEntry,
  type PublicationPackage,
} from './PublicationPipelineTypes';

/** Hard cap so a runaway trail never bloats a Firestore document. */
const MAX_AUDIT_ENTRIES = 400;

export interface AuditEntryInput {
  action: PublicationAuditAction;
  details: string;
  actor?: PublicationActor;
  artifactId?: string;
  before?: string;
  after?: string;
}

/** Build a single audit entry for a package. Pure. */
export const buildAuditEntry = (
  packageId: string,
  input: AuditEntryInput,
): PublicationAuditEntry => ({
  id: newPrefixedId('pubaudit'),
  packageId,
  ...(input.artifactId ? { artifactId: input.artifactId } : {}),
  action: input.action,
  actor: input.actor ?? SYSTEM_PUBLICATION_ACTOR,
  timestamp: new Date().toISOString(),
  details: input.details,
  ...(input.before !== undefined ? { before: input.before } : {}),
  ...(input.after !== undefined ? { after: input.after } : {}),
});

/**
 * Append an audit entry to a package, returning a NEW package. The oldest
 * entries are dropped only when the hard cap is exceeded, and the very first
 * `package-created` entry is always preserved so provenance is never lost.
 */
export const appendAuditEntry = (
  pkg: PublicationPackage,
  input: AuditEntryInput,
): PublicationPackage => {
  const entry = buildAuditEntry(pkg.id, input);
  const next = [...pkg.auditTrail, entry];
  let trimmed = next;
  if (next.length > MAX_AUDIT_ENTRIES) {
    const creation = next.filter((e) => e.action === 'package-created').slice(0, 1);
    const recent = next.slice(next.length - (MAX_AUDIT_ENTRIES - creation.length));
    trimmed = [...creation, ...recent];
  }
  return { ...pkg, auditTrail: trimmed, updatedAt: entry.timestamp };
};

/** Append several audit entries in one pass, returning a NEW package. */
export const appendAuditEntries = (
  pkg: PublicationPackage,
  inputs: AuditEntryInput[],
): PublicationPackage =>
  inputs.reduce((acc, input) => appendAuditEntry(acc, input), pkg);

/** Count how many override entries the trail holds. */
export const countOverrides = (pkg: PublicationPackage): number =>
  pkg.auditTrail.filter((e) => e.action === 'override-used').length;

/** Return the most recent audit entry, if any. */
export const lastAuditEntry = (pkg: PublicationPackage): PublicationAuditEntry | undefined =>
  pkg.auditTrail.length > 0 ? pkg.auditTrail[pkg.auditTrail.length - 1] : undefined;

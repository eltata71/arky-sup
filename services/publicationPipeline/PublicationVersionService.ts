/**
 * Publication package versioning (Task 9).
 *
 * A package freezes a set of artifact references at a known version. When the
 * underlying artifacts evolve the package drifts:
 *  - `stale`    — one or more referenced artifacts have a newer version;
 *  - `outdated` — one or more referenced artifacts no longer exist.
 *
 * The version service detects that drift, builds fresh artifact references and
 * mints new package versions. It never mutates artifact versioning — it only
 * reads the project's artifacts. Every helper is pure and total.
 */

import type { Artifact } from '../../lib/artifacts';
import { resolveArtifactCompilation } from './PublicationQualityBridge';
import { appendAuditEntry } from './PublicationAuditTrailService';
import { trackPublicationEvent } from './PublicationObservability';
import type {
  PublicationActor,
  PublicationArtifactRef,
  PublicationFreshness,
  PublicationPackage,
  PublicationVersionDiff,
} from './PublicationPipelineTypes';

/** Build a frozen artifact reference snapshot from a live artifact. */
export const buildArtifactRef = (artifact: Artifact): PublicationArtifactRef => {
  const compilation = resolveArtifactCompilation(artifact);
  return {
    artifactId: artifact.id,
    versionGroupId: artifact.versionGroupId,
    version: artifact.version,
    name: artifact.name,
    type: artifact.type,
    compilerTier: compilation.compilerTier,
    compilerScore: compilation.compilerScore,
  };
};

/** Latest version number across a version group, or 0 when none exist. */
const latestVersionInGroup = (artifacts: Artifact[], versionGroupId: string): number => {
  const versions = artifacts
    .filter((a) => a.versionGroupId === versionGroupId)
    .map((a) => a.version);
  return versions.length > 0 ? Math.max(...versions) : 0;
};

/**
 * Compare a package against the project's current artifacts and classify its
 * freshness. Pure — never throws.
 */
export const computeVersionDiff = (
  pkg: PublicationPackage,
  currentArtifacts: Artifact[],
): PublicationVersionDiff => {
  const changedArtifactIds: string[] = [];
  const removedArtifactIds: string[] = [];

  for (const ref of pkg.artifactRefs) {
    const latest = latestVersionInGroup(currentArtifacts, ref.versionGroupId);
    if (latest === 0) {
      removedArtifactIds.push(ref.artifactId);
    } else if (latest > ref.version) {
      changedArtifactIds.push(ref.artifactId);
    }
  }

  let freshness: PublicationFreshness = 'current';
  if (removedArtifactIds.length > 0) freshness = 'outdated';
  else if (changedArtifactIds.length > 0) freshness = 'stale';

  const message = freshness === 'current'
    ? 'El paquete está alineado con la versión actual de sus artefactos.'
    : freshness === 'stale'
      ? `${changedArtifactIds.length} artefacto(s) del paquete tienen una versión más reciente.`
      : `${removedArtifactIds.length} artefacto(s) del paquete ya no existen en el proyecto.`;

  return { freshness, changedArtifactIds, removedArtifactIds, message };
};

/**
 * Re-evaluate a package's freshness against the current artifacts and return a
 * NEW package with the updated `freshness` flag. Records an audit entry only
 * when the package transitions out of `current`.
 */
export const refreshPackageFreshness = (
  pkg: PublicationPackage,
  currentArtifacts: Artifact[],
): PublicationPackage => {
  const diff = computeVersionDiff(pkg, currentArtifacts);
  if (diff.freshness === pkg.freshness) return pkg;

  let next: PublicationPackage = { ...pkg, freshness: diff.freshness, updatedAt: new Date().toISOString() };
  if (diff.freshness !== 'current') {
    next = appendAuditEntry(next, {
      action: 'marked-outdated',
      details: diff.message,
    });
    trackPublicationEvent('publication.package.outdated', diff.message, {
      packageId: pkg.id, freshness: diff.freshness,
    });
  }
  return next;
};

/**
 * Mint a new package version. Refreshes every artifact reference to its latest
 * version, increments the package version, resets freshness to `current` and
 * records an audit entry. Returns a NEW package.
 */
export const createPackageVersion = (
  pkg: PublicationPackage,
  currentArtifacts: Artifact[],
  actor?: PublicationActor,
): PublicationPackage => {
  const refreshedRefs: PublicationArtifactRef[] = pkg.artifactRefs.map((ref) => {
    const latest = currentArtifacts
      .filter((a) => a.versionGroupId === ref.versionGroupId)
      .sort((a, b) => b.version - a.version)[0];
    return latest ? buildArtifactRef(latest) : ref;
  });

  const nextVersion = pkg.version + 1;
  const next: PublicationPackage = {
    ...pkg,
    version: nextVersion,
    artifactRefs: refreshedRefs,
    freshness: 'current',
    // A new version invalidates a prior approval/publication.
    status: pkg.status === 'published' || pkg.status === 'approved' ? 'draft' : pkg.status,
    approvedBy: undefined,
    approvedAt: undefined,
    updatedAt: new Date().toISOString(),
  };

  const audited = appendAuditEntry(next, {
    action: 'version-created',
    details: `Versión ${nextVersion} del paquete creada con artefactos actualizados.`,
    ...(actor ? { actor } : {}),
    before: `v${pkg.version}`,
    after: `v${nextVersion}`,
  });

  trackPublicationEvent('publication.version.created',
    `Versión ${nextVersion} del paquete "${pkg.name}" creada.`,
    { packageId: pkg.id, version: nextVersion });

  return audited;
};

/** True when a published package has drifted and should be re-versioned. */
export const isPublishedPackageOutdated = (
  pkg: PublicationPackage,
  currentArtifacts: Artifact[],
): boolean => {
  if (pkg.status !== 'published') return false;
  return computeVersionDiff(pkg, currentArtifacts).freshness !== 'current';
};

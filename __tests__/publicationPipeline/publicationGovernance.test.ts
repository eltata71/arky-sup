import { describe, expect, it } from 'vitest';
import {
  createPublicationPackage,
  resolvePublicationProfile,
  evaluatePackageReadiness,
  submitForReview,
  requestChanges,
  approvePackage,
  publishPackage,
  archivePackage,
  computeVersionDiff,
  createPackageVersion,
  isPublishedPackageOutdated,
  generatePublicationManifest,
  assertManifestIsSafe,
  type PublicationPackage,
} from '../../services/publicationPipeline';
import { c4ContextDiagram, worldClassDocument, corruptDocument, makeArtifact } from './fixtures';

const executiveProfile = resolvePublicationProfile('executive-architecture-brief');

const cleanPackage = (): { pkg: PublicationPackage; artifacts: ReturnType<typeof worldClassDocument>[] } => {
  const artifacts = [c4ContextDiagram(), worldClassDocument()];
  const pkg = createPublicationPackage(
    {
      projectId: 'proj-1',
      name: 'Brief ejecutivo',
      profileId: 'executive-architecture-brief',
      artifactIds: artifacts.map((a) => a.id),
    },
    artifacts,
  );
  return { pkg, artifacts };
};

describe('publication approval workflow', () => {
  it('approves a package with no blockers', () => {
    const { pkg, artifacts } = cleanPackage();
    const readiness = evaluatePackageReadiness({ pkg, profile: executiveProfile, artifacts });
    expect(readiness.status).toBe('passed');

    const submitted = submitForReview(pkg);
    expect(submitted.ok).toBe(true);
    expect(submitted.package.status).toBe('ready-for-review');

    const approved = approvePackage(submitted.package, readiness);
    expect(approved.ok).toBe(true);
    expect(approved.package.status).toBe('approved');
    expect(approved.package.auditTrail.some((e) => e.action === 'approved')).toBe(true);
  });

  it('impedes approval when there are critical blockers', () => {
    const artifacts = [corruptDocument()];
    const pkg = createPublicationPackage(
      { projectId: 'proj-1', name: 'Paquete bloqueado', profileId: 'executive-architecture-brief', artifactIds: ['art-corrupt'] },
      artifacts,
    );
    const readiness = evaluatePackageReadiness({ pkg, profile: executiveProfile, artifacts });
    expect(readiness.status).toBe('blocked');

    const submitted = submitForReview(pkg);
    const approved = approvePackage(submitted.package, readiness);
    expect(approved.ok).toBe(false);
    expect(approved.package.status).not.toBe('approved');
  });

  it('publishes an approved package', () => {
    const { pkg, artifacts } = cleanPackage();
    const readiness = evaluatePackageReadiness({ pkg, profile: executiveProfile, artifacts });
    const submitted = submitForReview(pkg);
    const approved = approvePackage(submitted.package, readiness);
    const published = publishPackage(approved.package, readiness, { approvalRequired: true });
    expect(published.ok).toBe(true);
    expect(published.package.status).toBe('published');
    expect(published.package.publishedAt).toBeTruthy();
  });

  it('impedes publishing an unapproved package when the profile requires approval', () => {
    const { pkg, artifacts } = cleanPackage();
    const readiness = evaluatePackageReadiness({ pkg, profile: executiveProfile, artifacts });
    const published = publishPackage(pkg, readiness, { approvalRequired: true });
    expect(published.ok).toBe(false);
    expect(published.package.status).toBe('draft');
  });

  it('records the reason when changes are requested', () => {
    const { pkg } = cleanPackage();
    const submitted = submitForReview(pkg);
    const changes = requestChanges(submitted.package, 'Falta la sección de KPIs.');
    expect(changes.ok).toBe(true);
    expect(changes.package.status).toBe('changes-requested');
    expect(changes.package.auditTrail.some((e) => e.details.includes('KPIs'))).toBe(true);
  });

  it('archives a package and preserves its history', () => {
    const { pkg } = cleanPackage();
    const archived = archivePackage(pkg, undefined, 'Reemplazado por una nueva versión.');
    expect(archived.ok).toBe(true);
    expect(archived.package.status).toBe('archived');
    expect(archived.package.auditTrail.length).toBeGreaterThan(pkg.auditTrail.length);
  });
});

describe('publication versioning', () => {
  it('mints a new package version and resets it to draft', () => {
    const { pkg } = cleanPackage();
    const versioned = createPackageVersion(pkg, [c4ContextDiagram(), worldClassDocument()]);
    expect(versioned.version).toBe(2);
    expect(versioned.status).toBe('draft');
    expect(versioned.auditTrail.some((e) => e.action === 'version-created')).toBe(true);
  });

  it('detects a package that is stale because an artifact changed', () => {
    const { pkg } = cleanPackage();
    // simulate a newer version of one referenced artifact
    const newerArtifacts = [
      makeArtifact({ id: 'art-c4-context-v2', versionGroupId: 'vg-c4-context', version: 3 }),
      worldClassDocument(),
    ];
    const diff = computeVersionDiff(pkg, newerArtifacts);
    expect(diff.freshness).toBe('stale');
    expect(diff.changedArtifactIds).toContain('art-c4-context');
  });

  it('detects an outdated published package', () => {
    const { pkg } = cleanPackage();
    const published: PublicationPackage = { ...pkg, status: 'published' };
    const newerArtifacts = [
      makeArtifact({ id: 'art-c4-context-v2', versionGroupId: 'vg-c4-context', version: 5 }),
      worldClassDocument(),
    ];
    expect(isPublishedPackageOutdated(published, newerArtifacts)).toBe(true);
  });
});

describe('publication manifest', () => {
  it('generates a manifest with no sensitive data', () => {
    const { pkg, artifacts } = cleanPackage();
    const readiness = evaluatePackageReadiness({ pkg, profile: executiveProfile, artifacts });
    const manifest = generatePublicationManifest({
      pkg,
      profile: executiveProfile,
      projectName: 'Proyecto de prueba',
      readiness,
    });
    expect(manifest.packageId).toBe(pkg.id);
    expect(manifest.artifacts.length).toBe(pkg.artifactRefs.length);
    expect(manifest.qualityScore).toBeGreaterThanOrEqual(0);
    expect(assertManifestIsSafe(manifest)).toHaveLength(0);
  });
});

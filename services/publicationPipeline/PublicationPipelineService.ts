/**
 * Publication pipeline facade (Task 2).
 *
 * This is the single composition entry point the app/UI calls. It wires the
 * focused services — package, preflight, readiness, accessibility, approval,
 * version, manifest, export — into coherent, project-aware operations, and
 * resolves a package's frozen artifact references against the project's live
 * artifacts.
 *
 * Every operation is total: it degrades into a safe, blocked result rather
 * than throwing, so the UI never faces a blank screen.
 */

import type { Artifact } from '../../types';
import {
  getPublicationProfile,
  resolvePublicationProfile,
} from './PublicationTemplateRegistry';
import { createPublicationPackage } from './PublicationPackageService';
import { runPackagePreflight, type PackagePreflightInput } from './PublicationPreflightService';
import {
  evaluatePackageReadiness,
  buildPublicationReport,
} from './PublicationReadinessService';
import { evaluatePublicationAccessibility } from './PublicationAccessibilityService';
import { generatePublicationManifest } from './PublicationManifestService';
import { refreshPackageFreshness, createPackageVersion } from './PublicationVersionService';
import { publishPackage as approvalPublish, type PublishOptions, type PublicationTransitionResult } from './PublicationApprovalService';
import type {
  CreatePublicationPackageInput,
  PublicationManifest,
  PublicationManifestFile,
  PublicationPackage,
  PublicationPreflightReport,
  PublicationProfile,
  PublicationProjectInput,
  PublicationReadinessReport,
  PublicationReport,
} from './PublicationPipelineTypes';

/** Latest artifact per version group, keyed by version group id. */
const latestByGroup = (artifacts: Artifact[]): Map<string, Artifact> => {
  const map = new Map<string, Artifact>();
  for (const artifact of artifacts) {
    const current = map.get(artifact.versionGroupId);
    if (!current || artifact.version > current.version) map.set(artifact.versionGroupId, artifact);
  }
  return map;
};

/**
 * Resolve a package's frozen artifact references against the project's live
 * artifacts. References are resolved to the latest version in their group;
 * missing artifacts are skipped (the preflight then reports them).
 */
export const resolvePackageArtifacts = (
  pkg: PublicationPackage,
  projectArtifacts: Artifact[],
): Artifact[] => {
  const byGroup = latestByGroup(projectArtifacts);
  const byId = new Map(projectArtifacts.map((a) => [a.id, a]));
  const resolved: Artifact[] = [];
  for (const ref of pkg.artifactRefs) {
    const artifact = byGroup.get(ref.versionGroupId) ?? byId.get(ref.artifactId);
    if (artifact) resolved.push(artifact);
  }
  return resolved;
};

/** Resolve the profile a package was built against (always succeeds). */
export const resolvePackageProfile = (pkg: PublicationPackage): PublicationProfile =>
  resolvePublicationProfile(pkg.profileId);

/* ------------------------------------------------------------------------- */
/* Composite operations                                                       */
/* ------------------------------------------------------------------------- */

/** Create a package within a project. */
export const createPackageForProject = (
  project: PublicationProjectInput,
  input: Omit<CreatePublicationPackageInput, 'projectId'>,
): PublicationPackage =>
  createPublicationPackage({ ...input, projectId: project.projectId }, project.artifacts);

/** Run package preflight against the project's live artifacts. */
export const runProjectPackagePreflight = (
  project: PublicationProjectInput,
  pkg: PublicationPackage,
): PublicationPreflightReport => {
  const profile = resolvePackageProfile(pkg);
  const artifacts = resolvePackageArtifacts(pkg, project.artifacts);
  const accessibility = evaluatePublicationAccessibility(
    artifacts, profile.accessibilityLevel, 'package', pkg.id,
  );
  const input: PackagePreflightInput = {
    packageId: pkg.id,
    artifacts,
    profile,
    graph: project.architectureKnowledgeGraph,
    graphFreshness: project.architectureKnowledgeGraphFreshness,
    accessibilityBlocked: accessibility.blocked,
    accessibilityIssueCount: accessibility.issues.length,
  };
  return runPackagePreflight(input);
};

/** Evaluate full package readiness + render the publication report. */
export const evaluateProjectPackage = (
  project: PublicationProjectInput,
  pkg: PublicationPackage,
): { profile: PublicationProfile; readiness: PublicationReadinessReport; report: PublicationReport } => {
  const profile = resolvePackageProfile(pkg);
  const artifacts = resolvePackageArtifacts(pkg, project.artifacts);
  const readiness = evaluatePackageReadiness({
    pkg,
    profile,
    artifacts,
    graph: project.architectureKnowledgeGraph,
    graphFreshness: project.architectureKnowledgeGraphFreshness,
  });
  const report = buildPublicationReport(pkg, profile, readiness, project.projectName);
  return { profile, readiness, report };
};

/** Generate the manifest for a package (without publishing it). */
export const generateProjectPackageManifest = (
  project: PublicationProjectInput,
  pkg: PublicationPackage,
  options: { generatedBy?: PublicationManifest['generatedBy']; exportedFiles?: PublicationManifestFile[] } = {},
): { manifest: PublicationManifest; readiness: PublicationReadinessReport } => {
  const { profile, readiness } = evaluateProjectPackage(project, pkg);
  const manifest = generatePublicationManifest({
    pkg,
    profile,
    projectName: project.projectName,
    readiness,
    ...(options.generatedBy ? { generatedBy: options.generatedBy } : {}),
    ...(options.exportedFiles ? { exportedFiles: options.exportedFiles } : {}),
  });
  return { manifest, readiness };
};

export interface PublishPackageResult {
  result: PublicationTransitionResult;
  readiness: PublicationReadinessReport;
  report: PublicationReport;
  manifest: PublicationManifest;
}

/**
 * Publish a package: evaluate readiness, render the report, generate the
 * manifest and run the governed publish transition (which enforces every
 * Task 19 hard rule). Returns the full evidence bundle.
 */
export const publishProjectPackage = (
  project: PublicationProjectInput,
  pkg: PublicationPackage,
  options: Omit<PublishOptions, 'approvalRequired' | 'manifest'>,
): PublishPackageResult => {
  const { profile, readiness, report } = evaluateProjectPackage(project, pkg);
  const manifest = generatePublicationManifest({
    pkg,
    profile,
    projectName: project.projectName,
    readiness,
    ...(options.actor ? { generatedBy: options.actor } : {}),
  });
  const result = approvalPublish(pkg, readiness, {
    ...options,
    approvalRequired: profile.approvalRequired,
    manifest,
  });
  return { result, readiness, report, manifest };
};

/** Re-evaluate every package's freshness against the project's artifacts. */
export const refreshProjectPackages = (
  project: PublicationProjectInput,
  packages: PublicationPackage[],
): PublicationPackage[] =>
  packages.map((pkg) => refreshPackageFreshness(pkg, project.artifacts));

/** Mint a new package version aligned with the project's current artifacts. */
export const versionProjectPackage = (
  project: PublicationProjectInput,
  pkg: PublicationPackage,
  actor?: CreatePublicationPackageInput['actor'],
): PublicationPackage => createPackageVersion(pkg, project.artifacts, actor);

/** True when a profile id resolves to a registered profile. */
export const isKnownPublicationProfile = (profileId: string): boolean =>
  getPublicationProfile(profileId) !== undefined;

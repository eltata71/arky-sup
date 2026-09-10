/**
 * Publication manifest generation (Task 3 & 19).
 *
 * The manifest is a tamper-evident, auditable record of exactly what a
 * published package contained: artifacts, versions, quality, accessibility,
 * traceability coverage, exported files and approval/audit metadata.
 *
 * Security rule (Task 19): the manifest carries ONLY display + governance
 * metadata. It never embeds artifact content, API keys, secrets or any
 * sensitive configuration — see {@link assertManifestIsSafe}.
 *
 * Pure & total — never throws.
 */

import {
  countOverrides,
  lastAuditEntry,
} from './PublicationAuditTrailService';
import { trackPublicationEvent } from './PublicationObservability';
import type {
  PublicationActor,
  PublicationManifest,
  PublicationManifestFile,
  PublicationPackage,
  PublicationProfile,
  PublicationReadinessReport,
} from './PublicationPipelineTypes';

/** A coarse heuristic for forbidden sensitive keys in the manifest payload. */
const SENSITIVE_KEY = /(api[_-]?key|secret|token|password|credential|private[_-]?key)/i;

export interface GenerateManifestInput {
  pkg: PublicationPackage;
  profile: PublicationProfile;
  projectName: string;
  readiness: PublicationReadinessReport;
  /** Files produced by the export orchestrator, when available. */
  exportedFiles?: PublicationManifestFile[];
  generatedBy?: PublicationActor;
}

/**
 * Build the publication manifest for a package. The artifact list is taken
 * from the package's frozen references, so the manifest reflects the exact
 * versioned snapshot — not whatever the project looks like now.
 */
export const generatePublicationManifest = (input: GenerateManifestInput): PublicationManifest => {
  const { pkg, profile, projectName, readiness } = input;
  const last = lastAuditEntry(pkg);

  const manifest: PublicationManifest = {
    packageId: pkg.id,
    packageVersion: pkg.version,
    projectId: pkg.projectId,
    projectName,
    profileId: profile.id,
    profileName: profile.name,
    audience: profile.audience,
    purpose: profile.purpose,
    generatedAt: new Date().toISOString(),
    ...(input.generatedBy ? { generatedBy: input.generatedBy } : {}),
    artifacts: pkg.artifactRefs.map((ref) => ({
      artifactId: ref.artifactId,
      name: ref.name,
      type: ref.type,
      version: ref.version,
      ...(typeof ref.compilerScore === 'number' ? { qualityScore: ref.compilerScore } : {}),
      ...(ref.compilerTier ? { qualityTier: ref.compilerTier } : {}),
    })),
    qualityScore: readiness.qualityResults.score,
    qualityTier: readiness.qualityResults.tier,
    accessibilityScore: readiness.accessibilityResults.score,
    traceabilityCoverage: readiness.traceabilityResults.requirementCoverage,
    architectureGraphCoverage: readiness.traceabilityResults.graphCoverage,
    exportedFiles: input.exportedFiles ?? [],
    approval: {
      required: profile.approvalRequired,
      status: pkg.status,
      ...(pkg.approvedBy ? { approvedBy: pkg.approvedBy } : {}),
      ...(pkg.approvedAt ? { approvedAt: pkg.approvedAt } : {}),
    },
    audit: {
      entryCount: pkg.auditTrail.length,
      ...(last ? { lastAction: last.action, lastActionAt: last.timestamp } : {}),
      overridesUsed: countOverrides(pkg),
    },
  };

  trackPublicationEvent('publication.manifest.generated',
    `Manifiesto generado para el paquete "${pkg.name}" (versión ${pkg.version}).`,
    { packageId: pkg.id, version: pkg.version, artifactCount: manifest.artifacts.length });

  return manifest;
};

/**
 * Verify a manifest carries no sensitive data. Returns the list of offending
 * key paths — empty when the manifest is safe. Used as a publish-time guard.
 */
export const assertManifestIsSafe = (manifest: PublicationManifest): string[] => {
  const offenders: string[] = [];
  const walk = (value: unknown, path: string): void => {
    if (value === null || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) offenders.push(`${path}.${key}`);
      if (typeof child === 'string' && SENSITIVE_KEY.test(child) && child.length > 24) {
        offenders.push(`${path}.${key}`);
      }
      walk(child, `${path}.${key}`);
    }
  };
  walk(manifest, 'manifest');
  return Array.from(new Set(offenders));
};

/**
 * Publication package lifecycle: creation, artifact selection and editorial
 * ordering (Task 10).
 *
 * A package groups artifacts into a deliverable. This service builds packages
 * from a manual selection or from a profile-driven suggestion, keeps artifact
 * references consistent, and orders artifacts into a sensible editorial flow.
 *
 * All helpers are pure and return new packages — they never mutate input and
 * never throw.
 */

import type { Artifact, ArtifactType } from '../../types';
import { newPrefixedId } from '../../lib/ids';
import {
  resolvePublicationProfile,
} from './PublicationTemplateRegistry';
import { buildArtifactRef } from './PublicationVersionService';
import { appendAuditEntry } from './PublicationAuditTrailService';
import { sanitizeBranding } from './PublicationBrandingService';
import { trackPublicationEvent } from './PublicationObservability';
import {
  PUBLICATION_SCHEMA_VERSION,
  type CreatePublicationPackageInput,
  type PublicationActor,
  type PublicationArtifactRef,
  type PublicationPackage,
  type PublicationProfile,
} from './PublicationPipelineTypes';

/** Editorial rank — lower sorts earlier in the deliverable. */
const TYPE_RANK: Partial<Record<ArtifactType, number>> = {
  'sdd-brd': 10,
  markdown: 12,
  'hybrid-text-diagram': 14,
  'presentation-executive': 16,
  'mermaid-c4-context': 20,
  'mermaid-c4-container': 22,
  'mermaid-c4-component': 24,
  'mermaid-c4-deployment': 26,
  'react-flow-graph': 28,
  'mermaid-graph': 30,
  'mermaid-erd': 34,
  'mermaid-sequence': 36,
  'mermaid-state': 38,
  'sdd-use-case': 42,
  'sdd-user-story': 44,
  'sdd-domain-model': 46,
  'sdd-event-storming': 48,
  'sdd-nfr': 52,
  'sdd-bdd': 54,
  'sdd-glossary': 60,
  'sdd-traceability': 64,
  'presentation-technical': 70,
  'mermaid-gantt': 74,
  yaml: 80,
};

const rankOf = (type: ArtifactType): number => TYPE_RANK[type] ?? 50;

/** Latest artifact for each version group, keyed by version group id. */
const latestByGroup = (artifacts: Artifact[]): Map<string, Artifact> => {
  const map = new Map<string, Artifact>();
  for (const artifact of artifacts) {
    const current = map.get(artifact.versionGroupId);
    if (!current || artifact.version > current.version) {
      map.set(artifact.versionGroupId, artifact);
    }
  }
  return map;
};

/** Resolve a set of artifact ids to their (latest) artifacts, preserving order. */
const resolveArtifacts = (artifactIds: string[], artifacts: Artifact[]): Artifact[] => {
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const byGroup = latestByGroup(artifacts);
  const resolved: Artifact[] = [];
  const seen = new Set<string>();
  for (const id of artifactIds) {
    const direct = byId.get(id);
    if (!direct) continue;
    const latest = byGroup.get(direct.versionGroupId) ?? direct;
    if (seen.has(latest.versionGroupId)) continue;
    seen.add(latest.versionGroupId);
    resolved.push(latest);
  }
  return resolved;
};

/** Order artifact references into the editorial flow of the deliverable. */
export const orderArtifactRefsEditorially = (
  refs: PublicationArtifactRef[],
): PublicationArtifactRef[] =>
  [...refs].sort((a, b) => {
    const rankDiff = rankOf(a.type) - rankOf(b.type);
    return rankDiff !== 0 ? rankDiff : a.name.localeCompare(b.name);
  });

/**
 * Suggest the artifacts that best satisfy a profile's coverage requirements.
 * Picks the highest-quality matching artifact per requirement, plus any extras
 * the optional requirements call for. Returns artifact ids.
 */
export const suggestPackageArtifacts = (
  profile: PublicationProfile,
  artifacts: Artifact[],
): string[] => {
  const latest = Array.from(latestByGroup(artifacts).values());
  const picked = new Set<string>();
  for (const req of profile.artifactRequirements) {
    const matches = latest
      .filter((a) => req.anyOf.includes(a.type))
      .sort((a, b) => (b.compilation?.compilerScore ?? 0) - (a.compilation?.compilerScore ?? 0))
      .slice(0, Math.max(req.min, 1));
    matches.forEach((m) => picked.add(m.id));
  }
  return Array.from(picked);
};

/**
 * Create a publication package. When `artifactIds` is omitted the package is
 * seeded with the profile's suggested artifacts. Never throws.
 */
export const createPublicationPackage = (
  input: CreatePublicationPackageInput,
  artifacts: Artifact[],
): PublicationPackage => {
  const profile = resolvePublicationProfile(input.profileId);
  const artifactIds = input.artifactIds && input.artifactIds.length > 0
    ? input.artifactIds
    : suggestPackageArtifacts(profile, artifacts);

  const resolved = resolveArtifacts(artifactIds, artifacts);
  const artifactRefs = orderArtifactRefsEditorially(resolved.map(buildArtifactRef));
  const now = new Date().toISOString();

  const base: PublicationPackage = {
    id: newPrefixedId('pubpkg'),
    schemaVersion: PUBLICATION_SCHEMA_VERSION,
    projectId: input.projectId,
    name: input.name.trim() || 'Paquete de publicación',
    description: (input.description ?? '').trim(),
    profileId: profile.id,
    artifactRefs,
    status: 'draft',
    version: 1,
    freshness: 'current',
    createdAt: now,
    updatedAt: now,
    ...(input.actor ? { createdBy: input.actor } : {}),
    branding: sanitizeBranding(input.branding, profile.audience),
    auditTrail: [],
  };

  const audited = appendAuditEntry(base, {
    action: 'package-created',
    details: `Paquete "${base.name}" creado con el perfil "${profile.name}" y ${artifactRefs.length} artefacto(s).`,
    ...(input.actor ? { actor: input.actor } : {}),
  });

  trackPublicationEvent('publication.package.created',
    `Paquete de publicación "${base.name}" creado.`,
    { packageId: base.id, profileId: profile.id, artifactCount: artifactRefs.length });

  return audited;
};

/**
 * Replace the artifacts of a package. Re-orders editorially, records an audit
 * entry and — when the package was already approved/published — drops it back
 * to `draft` so the change is re-reviewed. Returns a NEW package.
 */
export const updatePackageArtifacts = (
  pkg: PublicationPackage,
  artifactIds: string[],
  artifacts: Artifact[],
  actor?: PublicationActor,
): PublicationPackage => {
  const resolved = resolveArtifacts(artifactIds, artifacts);
  const artifactRefs = orderArtifactRefsEditorially(resolved.map(buildArtifactRef));
  const invalidatesApproval = pkg.status === 'approved' || pkg.status === 'published';

  const next: PublicationPackage = {
    ...pkg,
    artifactRefs,
    status: invalidatesApproval ? 'draft' : pkg.status,
    ...(invalidatesApproval ? { approvedBy: undefined, approvedAt: undefined } : {}),
    updatedAt: new Date().toISOString(),
  };

  const audited = appendAuditEntry(next, {
    action: 'artifacts-changed',
    details: `Artefactos del paquete actualizados (${artifactRefs.length} artefacto(s)).`
      + (invalidatesApproval ? ' El paquete vuelve a borrador para nueva revisión.' : ''),
    ...(actor ? { actor } : {}),
  });

  trackPublicationEvent('publication.package.updated',
    `Artefactos del paquete "${pkg.name}" actualizados.`,
    { packageId: pkg.id, artifactCount: artifactRefs.length });

  return audited;
};

/** Update a package's name / description. Returns a NEW package. */
export const updatePackageMetadata = (
  pkg: PublicationPackage,
  updates: { name?: string; description?: string },
  actor?: PublicationActor,
): PublicationPackage => {
  const next: PublicationPackage = {
    ...pkg,
    ...(updates.name !== undefined ? { name: updates.name.trim() || pkg.name } : {}),
    ...(updates.description !== undefined ? { description: updates.description.trim() } : {}),
    updatedAt: new Date().toISOString(),
  };
  return appendAuditEntry(next, {
    action: 'package-updated',
    details: 'Metadatos del paquete actualizados.',
    ...(actor ? { actor } : {}),
  });
};

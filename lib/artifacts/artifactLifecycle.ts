/**
 * Where an artifact stands in its life (14.0): borrador, en revisión, cambios
 * pedidos, aprobado, rechazado o publicado — **derived, never typed in**.
 *
 * The review stage comes from the artifact's own `reviewStatus`, which only
 * `reviewTransitions` moves; «publicado» comes from the publication packages,
 * and only when a *published* package carries **this** version. A package
 * that published version 2 says nothing about version 3: showing «publicado»
 * on an edit nobody has published is the lie this rule exists to prevent.
 *
 * It lives in `lib/artifacts`, a leaf, because three surfaces read it — the
 * canvas, the project hub and the dashboard — and the dashboard must not pay
 * for the artifacts context's barrel to learn a label. Publication packages
 * arrive through a port (`LifecyclePublication`) with only what is read.
 */
import type { Artifact, ArtifactReviewStatus } from './artifactModel';

export type ArtifactLifecycleStage =
  | 'draft'
  | 'in-review'
  | 'changes-requested'
  | 'approved'
  | 'rejected'
  | 'published';

/** The order the stages are reported in, from the start of the cycle to its end. */
export const ARTIFACT_LIFECYCLE_STAGES: readonly ArtifactLifecycleStage[] = [
  'draft', 'in-review', 'changes-requested', 'rejected', 'approved', 'published',
];

/** What the rule reads from a publication package. */
export interface LifecyclePublication {
  id: string;
  name: string;
  status: string;
  publishedAt?: string;
  approvedAt?: string;
  artifactRefs: readonly { versionGroupId: string; version: number }[];
}

/** What the timeline reads from a review decision. */
export interface LifecycleDecision {
  status: ArtifactReviewStatus;
  decidedAt: string;
  authorName?: string;
  rationale?: string;
}

const STAGE_BY_REVIEW: Record<ArtifactReviewStatus, ArtifactLifecycleStage> = {
  draft: 'draft',
  'pending-review': 'in-review',
  'changes-requested': 'changes-requested',
  approved: 'approved',
  rejected: 'rejected',
};

type LifecycleArtifact = Pick<Artifact, 'versionGroupId' | 'version' | 'reviewStatus'>;

const carries = (pkg: LifecyclePublication, artifact: LifecycleArtifact): boolean =>
  pkg.artifactRefs.some((ref) => ref.versionGroupId === artifact.versionGroupId && ref.version === artifact.version);

const carriesAnyVersion = (pkg: LifecyclePublication, artifact: LifecycleArtifact): boolean =>
  pkg.artifactRefs.some((ref) => ref.versionGroupId === artifact.versionGroupId);

export interface ArtifactLifecycle {
  stage: ArtifactLifecycleStage;
  /** Published packages that carry exactly this version. */
  publishedIn: LifecyclePublication[];
  /** True when an earlier version was published and this one has not been. */
  earlierVersionPublished: boolean;
}

export function deriveArtifactLifecycle(
  artifact: LifecycleArtifact,
  packages: readonly LifecyclePublication[] = [],
): ArtifactLifecycle {
  const published = packages.filter((pkg) => pkg.status === 'published');
  const publishedIn = published.filter((pkg) => carries(pkg, artifact));
  const earlierVersionPublished = publishedIn.length === 0 && published.some((pkg) => carriesAnyVersion(pkg, artifact));
  const stage = publishedIn.length > 0 ? 'published' : STAGE_BY_REVIEW[artifact.reviewStatus ?? 'draft'];
  return { stage, publishedIn, earlierVersionPublished };
}

export interface ArtifactLifecycleCounts {
  byStage: Record<ArtifactLifecycleStage, number>;
  /**
   * Artifacts whose review stage is not known here: their project's artifacts
   * are not loaded, and the index the portfolio carries has no review status.
   * Counted apart, never folded into «borrador» — unmeasured is not zero.
   */
  unmeasured: number;
}

interface LifecycleProject {
  artifacts?: readonly LifecycleArtifact[];
  artifactsLoaded?: boolean;
  artifactIndex?: readonly Pick<Artifact, 'versionGroupId' | 'version'>[];
  publicationPackages?: readonly LifecyclePublication[];
}

const latestPerGroup = <T extends { versionGroupId: string; version: number }>(items: readonly T[]): T[] => {
  const latest = new Map<string, T>();
  for (const item of items) {
    const current = latest.get(item.versionGroupId);
    if (!current || item.version > current.version) latest.set(item.versionGroupId, item);
  }
  return [...latest.values()];
};

/** How many artifacts stand in each stage — the dashboard's view of the same rule. */
export function countArtifactLifecycle(projects: readonly LifecycleProject[]): ArtifactLifecycleCounts {
  const byStage = Object.fromEntries(ARTIFACT_LIFECYCLE_STAGES.map((stage) => [stage, 0])) as Record<ArtifactLifecycleStage, number>;
  let unmeasured = 0;
  for (const project of projects) {
    const packages = project.publicationPackages ?? [];
    // One artifact per version group: the latest version is the one people work on.
    if (project.artifactsLoaded !== false && (project.artifacts?.length ?? 0) > 0) {
      for (const artifact of latestPerGroup(project.artifacts ?? [])) byStage[deriveArtifactLifecycle(artifact, packages).stage] += 1;
      continue;
    }
    for (const entry of latestPerGroup(project.artifactIndex ?? [])) {
      // Published is known from the index (version + packages); a review stage is not.
      if (deriveArtifactLifecycle(entry, packages).stage === 'published') byStage.published += 1;
      else unmeasured += 1;
    }
  }
  return { byStage, unmeasured };
}

export type ArtifactTimelineEvent =
  | { kind: 'version'; at: string; version: number; artifactId: string }
  | { kind: 'decision'; at: string; status: ArtifactReviewStatus; authorName?: string; rationale?: string }
  | { kind: 'published'; at: string; packageId: string; packageName: string; version: number };

/**
 * The artifact's history in one line: its versions, the review decisions on
 * them and the publications that carried them, oldest first. An event with no
 * date is left out rather than placed somewhere plausible.
 */
export function buildArtifactTimeline(input: {
  versions: readonly Pick<Artifact, 'id' | 'version' | 'versionGroupId' | 'createdAt'>[];
  decisions?: readonly LifecycleDecision[];
  packages?: readonly LifecyclePublication[];
}): ArtifactTimelineEvent[] {
  const groupId = input.versions[0]?.versionGroupId;
  const events: ArtifactTimelineEvent[] = [];
  for (const version of input.versions) {
    if (version.createdAt) events.push({ kind: 'version', at: version.createdAt, version: version.version, artifactId: version.id });
  }
  for (const decision of input.decisions ?? []) {
    if (decision.decidedAt) events.push({ kind: 'decision', at: decision.decidedAt, status: decision.status, authorName: decision.authorName, rationale: decision.rationale });
  }
  for (const pkg of input.packages ?? []) {
    if (pkg.status !== 'published' || !pkg.publishedAt) continue;
    const ref = pkg.artifactRefs.find((item) => item.versionGroupId === groupId);
    if (ref) events.push({ kind: 'published', at: pkg.publishedAt, packageId: pkg.id, packageName: pkg.name, version: ref.version });
  }
  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * The deliverables a project's artifacts are produced for, as a prompt reads
 * them (plan de calidad de artefactos, 7.3c).
 *
 * The Office's own runner briefed the model with the engagement — its brief,
 * its constraints, its criteria — but a generation from the Workspace knew
 * nothing of it: the committee asked for something, the charter says what is
 * out of scope, the ARB asked for changes, and the artifact generated next to
 * all that was written as if none of it existed. This is the Office's side of
 * the `ArtifactDeliverableContext` port; the AI layer reads the shape and
 * imports nothing of the Office.
 *
 * Two rules:
 * - **Only open work.** A delivered or cancelled engagement is history; its
 *   constraints no longer bind what is produced now.
 * - **The brief is verbatim.** It is what the business asked for; the charter
 *   is the Office's reading of it, and both travel.
 */
import type { ArtifactDeliverableContext } from '../../../lib/artifacts';
import type { OfficeEngagement, OfficeEngagementStatus } from './OfficeTypes';

const CLOSED: ReadonlySet<OfficeEngagementStatus> = new Set(['delivered', 'cancelled']);

/** How many open deliverables reach a prompt: the most recently touched first. */
const MAX_OPEN_DELIVERABLES = 3;

const clean = (values: readonly string[] | undefined): string[] =>
  (values ?? []).map((value) => value.trim()).filter(Boolean);

/** One engagement as an artifact prompt needs it. */
export function describeEngagementForArtifact(engagement: OfficeEngagement): ArtifactDeliverableContext {
  const lastArb = [...(engagement.arbDecisions ?? [])].sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0];
  return {
    title: engagement.title,
    brief: engagement.brief,
    status: engagement.status,
    objectives: clean(engagement.charter?.objectives),
    scope: clean(engagement.charter?.scope),
    outOfScope: clean(engagement.charter?.outOfScope),
    constraints: clean(engagement.charter?.constraints),
    regulatoryDrivers: clean(engagement.charter?.regulatoryDrivers),
    ...(lastArb && lastArb.verdict !== 'approved' && lastArb.rationale.trim()
      ? { arbObservation: lastArb.rationale.trim() }
      : {}),
  };
}

/** The project's open deliverables, most recently touched first. */
export function openDeliverablesForArtifacts(
  projectId: string,
  engagements: readonly OfficeEngagement[],
): ArtifactDeliverableContext[] {
  return engagements
    .filter((engagement) => engagement.projectId === projectId && !CLOSED.has(engagement.status))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, MAX_OPEN_DELIVERABLES)
    .map(describeEngagementForArtifact);
}

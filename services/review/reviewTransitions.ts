/**
 * Transition rules for the artifact review workflow.
 *
 * `ArtifactReviewStatus` declared five states and enforced none of them: any
 * status could be recorded from any status, and `previousStatus` was whatever
 * the caller passed. A five-state enum with no guards is a label, not a
 * workflow — the same distinction `PublicationApprovalService` already draws
 * for publication packages, and the reason that service (not this one) was the
 * model for the Architecture Office's review board.
 *
 * The graph:
 *
 *   draft ─▶ pending-review ─┬─▶ approved ─▶ (draft, on new edits)
 *     ▲                      ├─▶ changes-requested ─▶ draft | pending-review
 *     └──────────────────────┴─▶ rejected ─▶ draft
 *
 * Two rules shape it:
 *  - approval and rejection are *decisions*, so they may only follow a request
 *    for review — you cannot approve something nobody submitted;
 *  - every terminal state can return to `draft`, because an artifact is a
 *    living document and re-editing an approved artifact must be possible.
 */

import type { ArtifactReviewStatus } from '../../types';

export const ARTIFACT_REVIEW_TRANSITIONS: Readonly<
  Record<ArtifactReviewStatus, readonly ArtifactReviewStatus[]>
> = Object.freeze({
  draft: ['pending-review'],
  'pending-review': ['approved', 'changes-requested', 'rejected', 'draft'],
  'changes-requested': ['pending-review', 'draft'],
  approved: ['draft', 'pending-review'],
  rejected: ['draft', 'pending-review'],
});

/** Status an artifact holds before anyone has decided anything. */
export const INITIAL_REVIEW_STATUS: ArtifactReviewStatus = 'draft';

/**
 * True when `to` may follow `from`. An absent `from` is treated as `draft`,
 * which is the status a freshly generated artifact holds.
 *
 * Re-recording the *same* status is allowed: a reviewer restating a decision
 * with a fuller rationale is a legitimate act, and refusing it would push
 * callers to bypass the log.
 */
export const canTransitionReviewStatus = (
  from: ArtifactReviewStatus | undefined,
  to: ArtifactReviewStatus,
): boolean => {
  const current = from ?? INITIAL_REVIEW_STATUS;
  if (current === to) return true;
  return ARTIFACT_REVIEW_TRANSITIONS[current]?.includes(to) ?? false;
};

/** Statuses reachable from `from`, for a UI that offers only legal moves. */
export const allowedReviewTransitions = (
  from: ArtifactReviewStatus | undefined,
): ArtifactReviewStatus[] => {
  const current = from ?? INITIAL_REVIEW_STATUS;
  return [...(ARTIFACT_REVIEW_TRANSITIONS[current] ?? [])];
};

/** Raised when a caller tries to record an illegal transition. */
export class InvalidReviewTransitionError extends Error {
  public readonly from: ArtifactReviewStatus;
  public readonly to: ArtifactReviewStatus;

  constructor(from: ArtifactReviewStatus | undefined, to: ArtifactReviewStatus) {
    const current = from ?? INITIAL_REVIEW_STATUS;
    super(`Transición de revisión inválida: "${current}" → "${to}".`);
    this.name = 'InvalidReviewTransitionError';
    this.from = current;
    this.to = to;
  }
}

/** Spanish, user-facing explanation of why a transition was refused. */
export const describeInvalidTransition = (
  from: ArtifactReviewStatus | undefined,
  to: ArtifactReviewStatus,
): string => {
  const current = from ?? INITIAL_REVIEW_STATUS;
  if ((to === 'approved' || to === 'rejected') && current !== 'pending-review') {
    return 'Un artefacto debe estar en revisión antes de aprobarse o rechazarse.';
  }
  if (to === 'changes-requested' && current !== 'pending-review') {
    return 'Solo se pueden pedir cambios sobre un artefacto enviado a revisión.';
  }
  return `No se puede pasar de "${current}" a "${to}".`;
};

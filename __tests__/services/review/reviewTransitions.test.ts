/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import {
  ARTIFACT_REVIEW_TRANSITIONS,
  InvalidReviewTransitionError,
  allowedReviewTransitions,
  canTransitionReviewStatus,
  describeInvalidTransition,
} from '../../../services/review/reviewTransitions';
import { artifactReviewService } from '../../../services/review/artifactReviewService';
import type { ArtifactReviewStatus } from '../../../services/review';

const ALL: ArtifactReviewStatus[] = ['draft', 'pending-review', 'changes-requested', 'approved', 'rejected'];
const author = { id: 'u1', name: 'Ada' };

describe('reviewTransitions', () => {
  it('treats an absent status as draft', () => {
    expect(canTransitionReviewStatus(undefined, 'pending-review')).toBe(true);
    expect(canTransitionReviewStatus(undefined, 'approved')).toBe(false);
  });

  it('refuses to approve or reject something nobody submitted', () => {
    for (const from of ['draft', 'changes-requested', 'approved', 'rejected'] as ArtifactReviewStatus[]) {
      if (from === 'approved') continue;
      expect(canTransitionReviewStatus(from, 'approved'), `${from} → approved`).toBe(false);
    }
    expect(canTransitionReviewStatus('pending-review', 'approved')).toBe(true);
    expect(canTransitionReviewStatus('pending-review', 'rejected')).toBe(true);
  });

  it('lets every terminal state return to draft — an artifact keeps living', () => {
    for (const from of ['approved', 'rejected', 'changes-requested'] as ArtifactReviewStatus[]) {
      expect(canTransitionReviewStatus(from, 'draft'), `${from} → draft`).toBe(true);
    }
  });

  it('allows restating the same status so a fuller rationale is not blocked', () => {
    for (const status of ALL) {
      expect(canTransitionReviewStatus(status, status)).toBe(true);
    }
  });

  it('declares a reachable move for every state — no dead end', () => {
    for (const status of ALL) {
      expect(allowedReviewTransitions(status).length, status).toBeGreaterThan(0);
    }
  });

  it('only ever names real statuses as targets', () => {
    for (const targets of Object.values(ARTIFACT_REVIEW_TRANSITIONS)) {
      for (const target of targets) expect(ALL).toContain(target);
    }
  });

  it('explains a refusal in terms the reviewer can act on', () => {
    expect(describeInvalidTransition('draft', 'approved')).toMatch(/debe estar en revisión/i);
    expect(describeInvalidTransition('approved', 'changes-requested')).toMatch(/enviado a revisión/i);
  });
});

describe('artifactReviewService — enforcement', () => {
  // Each case uses a distinct artifact id, so no state leaks between them.
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('rejects an illegal transition instead of writing it to the log', () => {
    expect(() => artifactReviewService.recordDecision({
      artifactId: 'guard-1', projectId: 'p1', status: 'approved', author,
    })).toThrow(InvalidReviewTransitionError);

    expect(artifactReviewService.latestStatus('guard-1')).toBeUndefined();
  });

  it('records the legal path and stamps the real previous status', () => {
    artifactReviewService.recordDecision({ artifactId: 'guard-2', projectId: 'p1', status: 'pending-review', author });
    const decision = artifactReviewService.recordDecision({
      artifactId: 'guard-2', projectId: 'p1', status: 'approved', author,
    });

    expect(decision.status).toBe('approved');
    expect(decision.previousStatus).toBe('pending-review');
    expect(artifactReviewService.latestStatus('guard-2')).toBe('approved');
  });

  it('ignores a caller-supplied previousStatus that contradicts the log', () => {
    artifactReviewService.recordDecision({ artifactId: 'guard-3', projectId: 'p1', status: 'pending-review', author });

    // A caller claiming the artifact is still a draft must not be able to
    // rewrite history — that is exactly how a decision log drifts from reality.
    const decision = artifactReviewService.recordDecision({
      artifactId: 'guard-3', projectId: 'p1', status: 'approved', author, previousStatus: 'draft',
    });
    expect(decision.previousStatus).toBe('pending-review');
  });
});

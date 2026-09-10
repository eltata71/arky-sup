/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { artifactReviewService } from '../../../services/review/artifactReviewService';
import type { ArtifactCommentAuthor } from '../../../services/review';

const author: ArtifactCommentAuthor = { id: 'u1', name: 'Ada' };

describe('artifactReviewService façade — Phase 2', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reports a sync state for every artifact', () => {
    // No Firebase env in tests → the hybrid repository runs local-only.
    expect(artifactReviewService.getSyncState('a1').status).toBe('local-only');
  });

  it('keeps the synchronous add/list API working', () => {
    const comment = artifactReviewService.addComment({
      artifactId: 'a1',
      projectId: 'p1',
      anchor: { kind: 'artifact' },
      body: 'Comentario de equipo',
      author,
    });
    expect(comment.status).toBe('open');
    expect(artifactReviewService.listComments('a1')).toHaveLength(1);
    expect(artifactReviewService.listOpenCount('a1')).toBe(1);
  });

  it('stamps resolvedBy when a comment is resolved with an actor', () => {
    const comment = artifactReviewService.addComment({
      artifactId: 'a1',
      projectId: 'p1',
      anchor: { kind: 'artifact' },
      body: 'Resolver esto',
      author,
    });
    artifactReviewService.setCommentStatus(comment.id, 'resolved', author);
    const resolved = artifactReviewService.listComments('a1')[0];
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy?.id).toBe('u1');
    expect(resolved.resolvedAt).toBeTruthy();
  });

  it('records decisions and reports the latest status', () => {
    artifactReviewService.recordDecision({
      artifactId: 'a1',
      projectId: 'p1',
      status: 'pending-review',
      author,
    });
    artifactReviewService.recordDecision({
      artifactId: 'a1',
      projectId: 'p1',
      status: 'approved',
      author,
    });
    expect(artifactReviewService.latestStatus('a1')).toBe('approved');
    expect(artifactReviewService.listDecisions('a1')).toHaveLength(2);
  });

  it('ensureSynced is safe to call repeatedly', () => {
    expect(() => {
      artifactReviewService.ensureSynced('p1', 'a1');
      artifactReviewService.ensureSynced('p1', 'a1');
    }).not.toThrow();
  });
});

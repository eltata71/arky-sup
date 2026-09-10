/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { LocalArtifactReviewRepository } from '../../../services/review';
import type { ArtifactCommentAuthor } from '../../../services/review';

const author: ArtifactCommentAuthor = { id: 'u1', name: 'Ada' };
const base = { projectId: 'p1', artifactId: 'a1', anchor: { kind: 'artifact' as const }, author };

describe('LocalArtifactReviewRepository', () => {
  let repo: LocalArtifactReviewRepository;

  beforeEach(() => {
    window.localStorage.clear();
    repo = new LocalArtifactReviewRepository();
  });

  it('adds a comment and lists it', async () => {
    const comment = repo.addCommentSync({ ...base, body: 'Hola equipo' });
    expect(comment.status).toBe('open');
    expect(comment.source).toBe('local');
    expect(comment.visibility).toBe('team');
    expect(await repo.listComments('p1', 'a1')).toHaveLength(1);
  });

  it('replies to a comment', () => {
    const comment = repo.addCommentSync({ ...base, body: 'Pregunta' });
    const reply = repo.replyToCommentSync({
      projectId: 'p1',
      artifactId: 'a1',
      commentId: comment.id,
      body: 'Respuesta',
      author,
    });
    expect(reply.body).toBe('Respuesta');
    expect(repo.getCommentsSync('a1')[0].replies).toHaveLength(1);
  });

  it('resolves and reopens a comment, stamping resolvedBy/resolvedAt', () => {
    const comment = repo.addCommentSync({ ...base, body: 'Bloqueo' });
    const resolved = repo.setCommentStatusSync({
      projectId: 'p1',
      artifactId: 'a1',
      commentId: comment.id,
      status: 'resolved',
      actor: author,
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy?.id).toBe('u1');
    expect(resolved.resolvedAt).toBeTruthy();

    const reopened = repo.setCommentStatusSync({
      projectId: 'p1',
      artifactId: 'a1',
      commentId: comment.id,
      status: 'open',
      actor: author,
    });
    expect(reopened.status).toBe('open');
    expect(reopened.resolvedAt).toBeUndefined();
  });

  it('deletes a comment', () => {
    const comment = repo.addCommentSync({ ...base, body: 'Temporal' });
    repo.deleteCommentSync({ projectId: 'p1', artifactId: 'a1', commentId: comment.id });
    expect(repo.getCommentsSync('a1')).toHaveLength(0);
  });

  it('records decisions and reports the latest status', () => {
    repo.recordDecisionSync({ projectId: 'p1', artifactId: 'a1', status: 'pending-review', author });
    const second = repo.recordDecisionSync({ projectId: 'p1', artifactId: 'a1', status: 'approved', author });
    expect(second.previousStatus).toBe('pending-review');
    expect(repo.latestStatusSync('a1')).toBe('approved');
  });

  it('is idempotent when the same id is supplied twice (dedup)', () => {
    repo.addCommentSync({ ...base, id: 'fixed-1', body: 'first' });
    repo.addCommentSync({ ...base, id: 'fixed-1', body: 'first' });
    expect(repo.getCommentsSync('a1')).toHaveLength(1);
  });

  it('returns stable snapshot references between changes', () => {
    repo.addCommentSync({ ...base, body: 'A' });
    const snapshotA = repo.getCommentsSync('a1');
    const snapshotB = repo.getCommentsSync('a1');
    expect(snapshotA).toBe(snapshotB);
    repo.addCommentSync({ ...base, body: 'B' });
    expect(repo.getCommentsSync('a1')).not.toBe(snapshotA);
  });

  it('notifies subscribers on changes', () => {
    let hits = 0;
    const unsubscribe = repo.subscribe(() => {
      hits += 1;
    });
    repo.addCommentSync({ ...base, body: 'notify me' });
    expect(hits).toBe(1);
    unsubscribe();
    repo.addCommentSync({ ...base, body: 'silent' });
    expect(hits).toBe(1);
  });

  it('reports local-only sync state', () => {
    expect(repo.getSyncState('a1').status).toBe('local-only');
  });
});

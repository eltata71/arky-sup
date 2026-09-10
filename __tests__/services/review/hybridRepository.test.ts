/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FirestoreArtifactReviewRepository,
  HybridArtifactReviewRepository,
  LocalArtifactReviewRepository,
} from '../../../services/review';
import type { ArtifactCommentAuthor } from '../../../services/review';
import { FakeReviewGateway } from './fakeGateway';

const author: ArtifactCommentAuthor = { id: 'user-1', name: 'Ada' };
const base = { projectId: 'p1', artifactId: 'a1', anchor: { kind: 'artifact' as const }, author };

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('HybridArtifactReviewRepository', () => {
  let local: LocalArtifactReviewRepository;
  let gateway: FakeReviewGateway;
  let hybrid: HybridArtifactReviewRepository;

  beforeEach(() => {
    window.localStorage.clear();
    local = new LocalArtifactReviewRepository();
    gateway = new FakeReviewGateway();
    hybrid = new HybridArtifactReviewRepository(
      local,
      new FirestoreArtifactReviewRepository(gateway),
    );
  });

  it('writes locally and synchronises to the remote backend', async () => {
    await hybrid.addComment({ ...base, body: 'Hola' });
    expect(local.getCommentsSync('a1')).toHaveLength(1);
    expect(gateway.countComments('p1', 'a1')).toBe(1);
    expect(hybrid.getSyncState('a1').status).toBe('synced');
  });

  it('falls back to local-only when no remote repository is configured', () => {
    const localOnly = new HybridArtifactReviewRepository(local);
    const comment = localOnly.addCommentSync({ ...base, body: 'Sin Firebase' });
    expect(comment.id).toBeTruthy();
    expect(localOnly.getCachedComments('a1')).toHaveLength(1);
    expect(localOnly.getSyncState('a1').status).toBe('local-only');
  });

  it('keeps the comment locally and flags sync-error when the remote write fails', async () => {
    gateway.failNextWrite = true;
    await hybrid.addComment({ ...base, body: 'Falla remota' });
    expect(local.getCommentsSync('a1')).toHaveLength(1);
    expect(hybrid.getSyncState('a1').status).toBe('sync-error');
    expect(hybrid.getSyncState('a1').lastError).toBeTruthy();
  });

  it('merges local and remote records without duplication', async () => {
    hybrid.startRemoteSync('p1', 'a1');
    await hybrid.addComment({ ...base, body: 'Compartido' });
    await flush();
    const cached = hybrid.getCachedComments('a1');
    expect(cached).toHaveLength(1);
  });

  it('delivers comments through subscribeComments and stays subscribable', async () => {
    const seen: number[] = [];
    const unsubscribe = hybrid.subscribeComments('p1', 'a1', (comments) => seen.push(comments.length));
    expect(seen[0]).toBe(0);
    await hybrid.addComment({ ...base, body: 'evento' });
    expect(seen[seen.length - 1]).toBe(1);
    unsubscribe();
  });

  it('returns stable cached snapshots between changes', () => {
    hybrid.addCommentSync({ ...base, body: 'estable' });
    const snapshotA = hybrid.getCachedComments('a1');
    expect(hybrid.getCachedComments('a1')).toBe(snapshotA);
  });

  it('records decisions locally and remotely', async () => {
    await hybrid.recordDecision({ projectId: 'p1', artifactId: 'a1', status: 'approved', author });
    expect(local.latestStatusSync('a1')).toBe('approved');
    expect(gateway.countDecisions('p1', 'a1')).toBe(1);
  });
});

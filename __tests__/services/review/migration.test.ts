/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  RemoteArtifactReviewRepository,
  HybridArtifactReviewRepository,
  LocalArtifactReviewRepository,
} from '../../../services/review';
import type { ArtifactCommentAuthor } from '../../../services/review';
import { FakeReviewGateway } from './fakeGateway';

const author: ArtifactCommentAuthor = { id: 'user-1', name: 'Ada' };
const base = { projectId: 'p1', artifactId: 'a1', anchor: { kind: 'artifact' as const }, author };

describe('HybridArtifactReviewRepository — local → remote migration', () => {
  let local: LocalArtifactReviewRepository;
  let gateway: FakeReviewGateway;

  beforeEach(() => {
    window.localStorage.clear();
    local = new LocalArtifactReviewRepository();
    gateway = new FakeReviewGateway();
  });

  it('uploads pre-existing local records to the remote backend', async () => {
    local.addCommentSync({ ...base, body: 'comentario heredado 1' });
    local.addCommentSync({ ...base, body: 'comentario heredado 2' });
    local.recordDecisionSync({ projectId: 'p1', artifactId: 'a1', status: 'approved', author });

    const hybrid = new HybridArtifactReviewRepository(
      local,
      new RemoteArtifactReviewRepository(gateway),
    );
    const report = await hybrid.migrateLocalToRemote();

    expect(report.migratedComments).toBe(2);
    expect(report.migratedDecisions).toBe(1);
    expect(report.failed).toBe(0);
    expect(gateway.countComments('p1', 'a1')).toBe(2);
    expect(gateway.countDecisions('p1', 'a1')).toBe(1);
    // Local records are now flagged synced.
    expect(local.getAllCommentsSync().every((c) => c.source === 'synced')).toBe(true);
  });

  it('is idempotent — a second pass skips already-synced records (dedup)', async () => {
    local.addCommentSync({ ...base, body: 'una vez' });
    const hybrid = new HybridArtifactReviewRepository(
      local,
      new RemoteArtifactReviewRepository(gateway),
    );

    await hybrid.migrateLocalToRemote();
    const writesAfterFirst = gateway.writeCount;
    const second = await hybrid.migrateLocalToRemote();

    expect(second.migratedComments).toBe(0);
    expect(second.skippedDuplicates).toBeGreaterThanOrEqual(1);
    expect(gateway.writeCount).toBe(writesAfterFirst);
    expect(gateway.countComments('p1', 'a1')).toBe(1);
  });

  it('reports an error and migrates nothing when no remote backend is available', async () => {
    local.addCommentSync({ ...base, body: 'sin remoto' });
    const hybrid = new HybridArtifactReviewRepository(local);
    const report = await hybrid.migrateLocalToRemote();

    expect(report.attempted).toBe(0);
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it('records partial failures without losing local data', async () => {
    local.addCommentSync({ ...base, body: 'fallará en remoto' });
    gateway.failNextWrite = true;
    const hybrid = new HybridArtifactReviewRepository(
      local,
      new RemoteArtifactReviewRepository(gateway),
    );

    const report = await hybrid.migrateLocalToRemote();
    expect(report.failed).toBe(1);
    expect(local.getAllCommentsSync()).toHaveLength(1);
  });
});

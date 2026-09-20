import { beforeEach, describe, expect, it } from 'vitest';
import { RemoteArtifactReviewRepository } from '../../../services/review';
import type { ArtifactCommentAuthor } from '../../../services/review';
import { FakeReviewGateway } from './fakeGateway';

const author: ArtifactCommentAuthor = { id: 'user-1', name: 'Ada' };
const base = { projectId: 'p1', artifactId: 'a1', anchor: { kind: 'artifact' as const }, author };

describe('RemoteArtifactReviewRepository', () => {
  let gateway: FakeReviewGateway;
  let repo: RemoteArtifactReviewRepository;

  beforeEach(() => {
    gateway = new FakeReviewGateway();
    repo = new RemoteArtifactReviewRepository(gateway);
  });

  it('adds and lists comments remotely', async () => {
    const comment = await repo.addComment({ ...base, body: 'Comentario remoto' });
    expect(comment.source).toBe('synced');
    const comments = await repo.listComments('p1', 'a1');
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe('Comentario remoto');
  });

  it('replies, resolves and deletes comments remotely', async () => {
    const comment = await repo.addComment({ ...base, body: 'Hilo' });
    await repo.replyToComment({ ...base, commentId: comment.id, body: 'Respuesta' });
    const resolved = await repo.setCommentStatus({
      projectId: 'p1',
      artifactId: 'a1',
      commentId: comment.id,
      status: 'resolved',
      actor: author,
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedBy?.id).toBe('user-1');

    const afterReply = await repo.listComments('p1', 'a1');
    expect(afterReply[0].replies).toHaveLength(1);

    await repo.deleteComment({ projectId: 'p1', artifactId: 'a1', commentId: comment.id });
    expect(await repo.listComments('p1', 'a1')).toHaveLength(0);
  });

  it('records decisions and reports the latest status', async () => {
    await repo.recordDecision({ projectId: 'p1', artifactId: 'a1', status: 'pending-review', author });
    await repo.recordDecision({ projectId: 'p1', artifactId: 'a1', status: 'approved', author });
    expect(await repo.latestStatus('p1', 'a1')).toBe('approved');
  });

  it('delivers once through subscribeComments, and says so by not delivering again', async () => {
    // Firestore traía `onSnapshot`; las tablas de revisión no están publicadas
    // por Realtime, así que la suscripción entrega el estado actual y se queda
    // quieta. La prueba fija ese contrato en vez de esconderlo: un panel que
    // creyera estar al día sería peor que uno que sabe que no lo está — y el
    // repositorio híbrido sigue emitiendo los cambios locales, que es lo que
    // quien escribe necesita ver de inmediato.
    await repo.addComment({ ...base, body: 'ya existente' });
    const seen: number[] = [];
    const unsubscribe = repo.subscribeComments('p1', 'a1', (comments) => seen.push(comments.length));
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([1]);

    await repo.addComment({ ...base, body: 'posterior' });
    await Promise.resolve();
    expect(seen).toEqual([1]);
    unsubscribe();
  });

  it('stops delivering once unsubscribed', async () => {
    const seen: number[] = [];
    const unsubscribe = repo.subscribeComments('p1', 'a1', (comments) => seen.push(comments.length));
    unsubscribe();
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([]);
  });

  it('refuses writes when no user is authenticated', async () => {
    gateway.userId = null;
    expect(repo.isWritable()).toBe(false);
    await expect(repo.addComment({ ...base, body: 'no auth' })).rejects.toThrow(/autenticado/);
  });

  it('refuses reads when the database is unavailable', async () => {
    gateway.available = false;
    await expect(repo.listComments('p1', 'a1')).rejects.toThrow(/disponible/);
  });
});

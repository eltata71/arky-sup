/**
 * @vitest-environment jsdom
 *
 * Renders nothing, but the code it exercises needs a DOM (localStorage,
 * DOMPurify, `window`). The `node` project is the default — see
 * `vite.config.ts` — and this is the exception, declared where it is read.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { artifactReviewService } from '../../services/review/artifactReviewService';
import type { ArtifactCommentAuthor } from '../../services/review';

const author: ArtifactCommentAuthor = { id: 'u1', name: 'Ada' };

describe('artifactReviewService', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('starts with no comments for a fresh artifact', () => {
        expect(artifactReviewService.listComments('a1')).toEqual([]);
        expect(artifactReviewService.listOpenCount('a1')).toBe(0);
    });

    it('adds a comment and counts it as open', () => {
        const c = artifactReviewService.addComment({
            artifactId: 'a1',
            projectId: 'p1',
            anchor: { kind: 'artifact' },
            body: 'Hola equipo',
            author,
        });
        expect(c.body).toBe('Hola equipo');
        expect(c.status).toBe('open');
        expect(artifactReviewService.listComments('a1')).toHaveLength(1);
        expect(artifactReviewService.listOpenCount('a1')).toBe(1);
    });

    it('isolates comments by artifactId', () => {
        artifactReviewService.addComment({ artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'x', author });
        artifactReviewService.addComment({ artifactId: 'a2', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'y', author });
        expect(artifactReviewService.listComments('a1')).toHaveLength(1);
        expect(artifactReviewService.listComments('a2')).toHaveLength(1);
    });

    it('toggles comment status', () => {
        const c = artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'q', author,
        });
        artifactReviewService.setCommentStatus(c.id, 'resolved');
        expect(artifactReviewService.listComments('a1')[0].status).toBe('resolved');
        expect(artifactReviewService.listOpenCount('a1')).toBe(0);
    });

    it('appends replies', () => {
        const c = artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'parent', author,
        });
        const r = artifactReviewService.replyToComment(c.id, 'respuesta', { id: 'u2', name: 'Bo' });
        expect(r?.body).toBe('respuesta');
        expect(artifactReviewService.listComments('a1')[0].replies).toHaveLength(1);
    });

    it('deletes a comment', () => {
        const c = artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'borra', author,
        });
        expect(artifactReviewService.deleteComment(c.id)).toBe(true);
        expect(artifactReviewService.listComments('a1')).toHaveLength(0);
    });

    it('records and surfaces the latest review decision', () => {
        artifactReviewService.recordDecision({
            artifactId: 'a1', projectId: 'p1', status: 'pending-review', author,
        });
        artifactReviewService.recordDecision({
            artifactId: 'a1', projectId: 'p1', status: 'approved', rationale: 'OK', author,
        });
        expect(artifactReviewService.latestStatus('a1')).toBe('approved');
        expect(artifactReviewService.listDecisions('a1')).toHaveLength(2);
    });

    it('groups open comment counts by document section', () => {
        artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1',
            anchor: { kind: 'document-section', sectionId: 'intro', sectionTitle: 'Intro' },
            body: 'x', author,
        });
        artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1',
            anchor: { kind: 'document-section', sectionId: 'intro' },
            body: 'y', author,
        });
        const resolved = artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1',
            anchor: { kind: 'document-section', sectionId: 'riesgos' },
            body: 'z', author,
        });
        artifactReviewService.setCommentStatus(resolved.id, 'resolved');
        // Artifact-level comments must not leak into section counts.
        artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'general', author,
        });
        const counts = artifactReviewService.openCountsByDocumentSection('a1');
        expect(counts).toEqual({ intro: 2 });
    });

    it('notifies subscribers when state changes', () => {
        let calls = 0;
        const unsubscribe = artifactReviewService.subscribe(() => { calls += 1; });
        artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'tick', author,
        });
        expect(calls).toBe(1);
        unsubscribe();
        artifactReviewService.addComment({
            artifactId: 'a1', projectId: 'p1', anchor: { kind: 'artifact' }, body: 'silent', author,
        });
        expect(calls).toBe(1);
    });
});

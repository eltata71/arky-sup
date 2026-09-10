/**
 * In-memory fake of `ReviewFirestoreGateway` for repository tests.
 * Not a spec file — vitest only collects `*.test.ts`.
 */

import type { ArtifactComment, ArtifactReviewDecision } from '../../../services/review';
import type { ReviewFirestoreGateway } from '../../../services/review';

type CommentCb = (comments: ArtifactComment[]) => void;
type DecisionCb = (decisions: ArtifactReviewDecision[]) => void;

export class FakeReviewGateway implements ReviewFirestoreGateway {
  available = true;
  userId: string | null = 'user-1';
  /** When true the next write rejects (simulates a transient Firestore error). */
  failNextWrite = false;
  writeCount = 0;

  private comments = new Map<string, Map<string, ArtifactComment>>();
  private decisions = new Map<string, Map<string, ArtifactReviewDecision>>();
  private commentWatchers = new Map<string, Set<CommentCb>>();
  private decisionWatchers = new Map<string, Set<DecisionCb>>();

  private key(projectId: string, artifactId: string): string {
    return `${projectId}/${artifactId}`;
  }

  isAvailable(): boolean {
    return this.available;
  }

  currentUserId(): string | null {
    return this.userId;
  }

  private commentList(key: string): ArtifactComment[] {
    return Array.from(this.comments.get(key)?.values() ?? []).map((c) => ({
      ...c,
      source: 'remote' as const,
    }));
  }

  private decisionList(key: string): ArtifactReviewDecision[] {
    return Array.from(this.decisions.get(key)?.values() ?? []).map((d) => ({
      ...d,
      source: 'remote' as const,
    }));
  }

  private guardWrite(): void {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('Firestore write failed (simulated).');
    }
    this.writeCount += 1;
  }

  fetchComments(projectId: string, artifactId: string): Promise<ArtifactComment[]> {
    return Promise.resolve(this.commentList(this.key(projectId, artifactId)));
  }

  watchComments(
    projectId: string,
    artifactId: string,
    onData: CommentCb,
  ): () => void {
    const key = this.key(projectId, artifactId);
    const set = this.commentWatchers.get(key) ?? new Set<CommentCb>();
    set.add(onData);
    this.commentWatchers.set(key, set);
    onData(this.commentList(key));
    return () => set.delete(onData);
  }

  upsertComment(projectId: string, artifactId: string, comment: ArtifactComment): Promise<void> {
    try {
      this.guardWrite();
    } catch (error) {
      return Promise.reject(error);
    }
    const key = this.key(projectId, artifactId);
    const bucket = this.comments.get(key) ?? new Map<string, ArtifactComment>();
    bucket.set(comment.id, { ...comment });
    this.comments.set(key, bucket);
    for (const cb of this.commentWatchers.get(key) ?? []) cb(this.commentList(key));
    return Promise.resolve();
  }

  removeComment(projectId: string, artifactId: string, commentId: string): Promise<void> {
    try {
      this.guardWrite();
    } catch (error) {
      return Promise.reject(error);
    }
    const key = this.key(projectId, artifactId);
    this.comments.get(key)?.delete(commentId);
    for (const cb of this.commentWatchers.get(key) ?? []) cb(this.commentList(key));
    return Promise.resolve();
  }

  fetchDecisions(projectId: string, artifactId: string): Promise<ArtifactReviewDecision[]> {
    return Promise.resolve(this.decisionList(this.key(projectId, artifactId)));
  }

  watchDecisions(
    projectId: string,
    artifactId: string,
    onData: DecisionCb,
  ): () => void {
    const key = this.key(projectId, artifactId);
    const set = this.decisionWatchers.get(key) ?? new Set<DecisionCb>();
    set.add(onData);
    this.decisionWatchers.set(key, set);
    onData(this.decisionList(key));
    return () => set.delete(onData);
  }

  upsertDecision(
    projectId: string,
    artifactId: string,
    decision: ArtifactReviewDecision,
  ): Promise<void> {
    try {
      this.guardWrite();
    } catch (error) {
      return Promise.reject(error);
    }
    const key = this.key(projectId, artifactId);
    const bucket = this.decisions.get(key) ?? new Map<string, ArtifactReviewDecision>();
    bucket.set(decision.id, { ...decision });
    this.decisions.set(key, bucket);
    for (const cb of this.decisionWatchers.get(key) ?? []) cb(this.decisionList(key));
    return Promise.resolve();
  }

  /** Test helper: total comments stored for an artifact. */
  countComments(projectId: string, artifactId: string): number {
    return this.comments.get(this.key(projectId, artifactId))?.size ?? 0;
  }

  countDecisions(projectId: string, artifactId: string): number {
    return this.decisions.get(this.key(projectId, artifactId))?.size ?? 0;
  }
}

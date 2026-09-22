/**
 * LocalArtifactReviewRepository — localStorage-backed review persistence.
 *
 * This is the local-first tier: it always works (no network, no Firebase) and
 * is the durability guarantee. It exposes the async `ArtifactReviewRepository`
 * contract plus synchronous `*Sync` cores so the hybrid repository can apply
 * optimistic updates without awaiting.
 *
 * Storage keys are intentionally unchanged from the original
 * `artifactReviewService` so previously stored comments are never lost.
 */

import type {
  ArtifactComment,
  ArtifactCommentReply,
  ArtifactReviewDecision,
  ArtifactReviewStatus,
} from './ReviewTypes';
import {
  LOCAL_ONLY_SYNC_STATE,
  type AddCommentInput,
  type DeleteCommentInput,
  type RecordDecisionInput,
  type ReplyInput,
  type ReviewSyncState,
  type SetCommentStatusInput,
  type SyncAwareReviewRepository,
  type Unsubscribe,
} from './types';

export const COMMENTS_STORAGE_KEY = 'arky.artifactComments.v1';
export const DECISIONS_STORAGE_KEY = 'arky.artifactReviewDecisions.v1';

const randomSuffix = (): string => Math.random().toString(36).slice(2, 8);

export const newCommentId = (): string => `cmt_${Date.now()}_${randomSuffix()}`;
export const newReplyId = (): string => `rpl_${Date.now()}_${randomSuffix()}`;
export const newDecisionId = (): string => `dec_${Date.now()}_${randomSuffix()}`;

const byCreatedAt = <T extends { createdAt?: string; decidedAt?: string }>(a: T, b: T): number => {
  const av = a.createdAt ?? a.decidedAt ?? '';
  const bv = b.createdAt ?? b.decidedAt ?? '';
  return av < bv ? -1 : av > bv ? 1 : 0;
};

export class LocalArtifactReviewRepository implements SyncAwareReviewRepository {
  readonly kind = 'local' as const;

  private listeners = new Set<() => void>();

  // Memoised parses keyed on the raw localStorage string so snapshots keep a
  // stable reference between changes — and an external `localStorage.clear()`
  // is honoured because the raw string changes.
  private commentsRaw: string | null = null;
  private commentsAll: ArtifactComment[] = [];
  private commentsByArtifact = new Map<string, ArtifactComment[]>();
  private decisionsRaw: string | null = null;
  private decisionsAll: ArtifactReviewDecision[] = [];
  private decisionsByArtifact = new Map<string, ArtifactReviewDecision[]>();

  /* ---- low-level localStorage access ---- */

  private readRaw(key: string): string {
    if (typeof window === 'undefined') return '';
    try {
      return window.localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  }

  private writeRaw<T>(key: string, value: T[]): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // QuotaExceededError / private-mode — the in-memory parse still serves
      // the rest of the session; durability degrades gracefully.
    }
  }

  private allComments(): ArtifactComment[] {
    const raw = this.readRaw(COMMENTS_STORAGE_KEY);
    if (raw !== this.commentsRaw) {
      this.commentsRaw = raw;
      this.commentsByArtifact.clear();
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        this.commentsAll = Array.isArray(parsed) ? (parsed as ArtifactComment[]) : [];
      } catch {
        this.commentsAll = [];
      }
    }
    return this.commentsAll;
  }

  private allDecisions(): ArtifactReviewDecision[] {
    const raw = this.readRaw(DECISIONS_STORAGE_KEY);
    if (raw !== this.decisionsRaw) {
      this.decisionsRaw = raw;
      this.decisionsByArtifact.clear();
      try {
        const parsed = raw ? JSON.parse(raw) : [];
        this.decisionsAll = Array.isArray(parsed) ? (parsed as ArtifactReviewDecision[]) : [];
      } catch {
        this.decisionsAll = [];
      }
    }
    return this.decisionsAll;
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* ignore listener errors */
      }
    }
  }

  /* ---- subscriptions ---- */

  subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeComments(
    _projectId: string,
    artifactId: string,
    callback: (comments: ArtifactComment[]) => void,
  ): Unsubscribe {
    const emit = () => callback(this.getCommentsSync(artifactId));
    emit();
    return this.subscribe(emit);
  }

  subscribeDecisions(
    _projectId: string,
    artifactId: string,
    callback: (decisions: ArtifactReviewDecision[]) => void,
  ): Unsubscribe {
    const emit = () => callback(this.getDecisionsSync(artifactId));
    emit();
    return this.subscribe(emit);
  }

  /* ---- synchronous cores ---- */

  getCommentsSync(artifactId: string): ArtifactComment[] {
    this.allComments();
    const cached = this.commentsByArtifact.get(artifactId);
    if (cached) return cached;
    const next = this.commentsAll
      .filter((c) => c.artifactId === artifactId)
      .sort(byCreatedAt);
    this.commentsByArtifact.set(artifactId, next);
    return next;
  }

  getDecisionsSync(artifactId: string): ArtifactReviewDecision[] {
    this.allDecisions();
    const cached = this.decisionsByArtifact.get(artifactId);
    if (cached) return cached;
    const next = this.decisionsAll
      .filter((d) => d.artifactId === artifactId)
      .sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : 0));
    this.decisionsByArtifact.set(artifactId, next);
    return next;
  }

  addCommentSync(input: AddCommentInput): ArtifactComment {
    const now = input.createdAt ?? new Date().toISOString();
    const comment: ArtifactComment = {
      id: input.id ?? newCommentId(),
      artifactId: input.artifactId,
      projectId: input.projectId,
      anchor: input.anchor,
      body: input.body.trim(),
      status: 'open',
      createdAt: now,
      updatedAt: now,
      author: input.author,
      replies: [],
      tags: input.tags,
      visibility: input.visibility ?? 'team',
      source: 'local',
    };
    const all = this.allComments().slice();
    const existing = all.findIndex((c) => c.id === comment.id);
    if (existing === -1) {
      all.push(comment);
    } else {
      // Idempotent upsert — keeps migration and retries duplicate-free.
      all[existing] = { ...all[existing], ...comment, replies: all[existing].replies };
    }
    this.writeRaw(COMMENTS_STORAGE_KEY, all);
    this.notify();
    return comment;
  }

  replyToCommentSync(input: ReplyInput): ArtifactCommentReply {
    const all = this.allComments().slice();
    const idx = all.findIndex((c) => c.id === input.commentId);
    if (idx === -1) {
      throw new Error(`Comment ${input.commentId} not found`);
    }
    const reply: ArtifactCommentReply = {
      id: input.id ?? newReplyId(),
      body: input.body.trim(),
      createdAt: new Date().toISOString(),
      author: input.author,
    };
    if (all[idx].replies.some((r) => r.id === reply.id)) {
      return reply;
    }
    all[idx] = {
      ...all[idx],
      replies: [...all[idx].replies, reply],
      updatedAt: reply.createdAt,
    };
    this.writeRaw(COMMENTS_STORAGE_KEY, all);
    this.notify();
    return reply;
  }

  setCommentStatusSync(input: SetCommentStatusInput): ArtifactComment {
    const all = this.allComments().slice();
    const idx = all.findIndex((c) => c.id === input.commentId);
    if (idx === -1) {
      throw new Error(`Comment ${input.commentId} not found`);
    }
    const now = new Date().toISOString();
    const resolved = input.status === 'resolved';
    const next: ArtifactComment = {
      ...all[idx],
      status: input.status,
      updatedAt: now,
      resolvedAt: resolved ? now : undefined,
      resolvedBy: resolved ? input.actor : undefined,
    };
    all[idx] = next;
    this.writeRaw(COMMENTS_STORAGE_KEY, all);
    this.notify();
    return next;
  }

  deleteCommentSync(input: DeleteCommentInput): void {
    const all = this.allComments();
    const next = all.filter((c) => c.id !== input.commentId);
    if (next.length === all.length) return;
    this.writeRaw(COMMENTS_STORAGE_KEY, next);
    this.notify();
  }

  recordDecisionSync(input: RecordDecisionInput): ArtifactReviewDecision {
    const previous = input.previousStatus ?? this.latestStatusSync(input.artifactId);
    const decision: ArtifactReviewDecision = {
      id: input.id ?? newDecisionId(),
      artifactId: input.artifactId,
      projectId: input.projectId,
      status: input.status,
      rationale: input.rationale,
      decidedAt: new Date().toISOString(),
      author: input.author,
      previousStatus: previous,
      operationId: input.operationId,
      source: 'local',
    };
    const all = this.allDecisions().slice();
    if (all.some((d) => d.id === decision.id)) return decision;
    all.push(decision);
    this.writeRaw(DECISIONS_STORAGE_KEY, all);
    this.notify();
    return decision;
  }

  latestStatusSync(artifactId: string): ArtifactReviewStatus | undefined {
    const decisions = this.getDecisionsSync(artifactId);
    return decisions.length > 0 ? decisions[decisions.length - 1].status : undefined;
  }

  /** All locally stored comments — used by the migration pass. */
  getAllCommentsSync(): ArtifactComment[] {
    return this.allComments().slice();
  }

  /** All locally stored decisions — used by the migration pass. */
  getAllDecisionsSync(): ArtifactReviewDecision[] {
    return this.allDecisions().slice();
  }

  /** Flag a local record as confirmed-persisted remotely. */
  markCommentSyncedSync(commentId: string): void {
    const all = this.allComments().slice();
    const idx = all.findIndex((c) => c.id === commentId);
    if (idx === -1 || all[idx].source === 'synced') return;
    all[idx] = { ...all[idx], source: 'synced' };
    this.writeRaw(COMMENTS_STORAGE_KEY, all);
    this.notify();
  }

  markDecisionSyncedSync(decisionId: string): void {
    const all = this.allDecisions().slice();
    const idx = all.findIndex((d) => d.id === decisionId);
    if (idx === -1 || all[idx].source === 'synced') return;
    all[idx] = { ...all[idx], source: 'synced' };
    this.writeRaw(DECISIONS_STORAGE_KEY, all);
    this.notify();
  }

  /** Insert a fully-formed comment (used to ingest remote records locally). */
  upsertCommentRecordSync(comment: ArtifactComment): void {
    const all = this.allComments().slice();
    const idx = all.findIndex((c) => c.id === comment.id);
    if (idx === -1) all.push(comment);
    else all[idx] = comment;
    this.writeRaw(COMMENTS_STORAGE_KEY, all);
    this.notify();
  }

  upsertDecisionRecordSync(decision: ArtifactReviewDecision): void {
    const all = this.allDecisions().slice();
    const idx = all.findIndex((d) => d.id === decision.id);
    if (idx === -1) all.push(decision);
    else all[idx] = decision;
    this.writeRaw(DECISIONS_STORAGE_KEY, all);
    this.notify();
  }

  /* ---- async repository contract ---- */

  listComments(_projectId: string, artifactId: string): Promise<ArtifactComment[]> {
    return Promise.resolve(this.getCommentsSync(artifactId));
  }

  listDecisions(_projectId: string, artifactId: string): Promise<ArtifactReviewDecision[]> {
    return Promise.resolve(this.getDecisionsSync(artifactId));
  }

  addComment(input: AddCommentInput): Promise<ArtifactComment> {
    return Promise.resolve(this.addCommentSync(input));
  }

  replyToComment(input: ReplyInput): Promise<ArtifactCommentReply> {
    return Promise.resolve(this.replyToCommentSync(input));
  }

  setCommentStatus(input: SetCommentStatusInput): Promise<ArtifactComment> {
    return Promise.resolve(this.setCommentStatusSync(input));
  }

  deleteComment(input: DeleteCommentInput): Promise<void> {
    this.deleteCommentSync(input);
    return Promise.resolve();
  }

  recordDecision(input: RecordDecisionInput): Promise<ArtifactReviewDecision> {
    return Promise.resolve(this.recordDecisionSync(input));
  }

  latestStatus(_projectId: string, artifactId: string): Promise<ArtifactReviewStatus | undefined> {
    return Promise.resolve(this.latestStatusSync(artifactId));
  }

  /* ---- sync-aware extras ---- */

  getCachedComments(artifactId: string): ArtifactComment[] {
    return this.getCommentsSync(artifactId);
  }

  getCachedDecisions(artifactId: string): ArtifactReviewDecision[] {
    return this.getDecisionsSync(artifactId);
  }

  getSyncState(_artifactId: string): ReviewSyncState {
    return LOCAL_ONLY_SYNC_STATE;
  }
}

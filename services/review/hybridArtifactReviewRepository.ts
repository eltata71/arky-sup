/**
 * HybridArtifactReviewRepository — local-first review persistence with
 * best-effort remote synchronisation.
 *
 * Strategy:
 *  - Every mutation is applied to the local repository first, synchronously,
 *    so the UI is instant and data is durable even with no network.
 *  - The remote write is then attempted; success/failure updates a per-artifact
 *    `ReviewSyncState` surfaced to the UI. A remote failure never throws into
 *    the UI path — the review keeps working from localStorage.
 *  - Remote snapshots are merged into the local view (remote wins on ties).
 *  - `migrateLocalToRemote` pushes pre-existing local records to Firestore
 *    idempotently (dedup by id) once a user is authenticated.
 */

import type {
  ArtifactComment,
  ArtifactReviewDecision,
  ArtifactReviewStatus,
} from '../../types';
import { observabilityService } from '../observability';
import { createOperationId } from '../persistence';
import { LocalArtifactReviewRepository } from './localArtifactReviewRepository';
import { FirestoreArtifactReviewRepository } from './firestoreArtifactReviewRepository';
import {
  type AddCommentInput,
  type DeleteCommentInput,
  type RecordDecisionInput,
  type ReplyInput,
  type ReviewMigrationReport,
  type ReviewSyncState,
  type SetCommentStatusInput,
  type SyncAwareReviewRepository,
  type Unsubscribe,
} from './types';

const isOnline = (): boolean =>
  typeof navigator === 'undefined' || navigator.onLine !== false;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const mergeComments = (local: ArtifactComment[], remote: ArtifactComment[]): ArtifactComment[] => {
  const map = new Map<string, ArtifactComment>();
  for (const c of local) map.set(c.id, c);
  for (const c of remote) {
    const existing = map.get(c.id);
    if (!existing || c.updatedAt >= existing.updatedAt) map.set(c.id, c);
  }
  return Array.from(map.values()).sort((a, b) =>
    a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0,
  );
};

const mergeDecisions = (
  local: ArtifactReviewDecision[],
  remote: ArtifactReviewDecision[],
): ArtifactReviewDecision[] => {
  const map = new Map<string, ArtifactReviewDecision>();
  for (const d of local) map.set(d.id, d);
  for (const d of remote) map.set(d.id, d);
  return Array.from(map.values()).sort((a, b) =>
    a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : 0,
  );
};

export class HybridArtifactReviewRepository implements SyncAwareReviewRepository {
  readonly kind = 'hybrid' as const;

  private listeners = new Set<() => void>();
  private syncStates = new Map<string, ReviewSyncState>();

  private remoteCommentSubs = new Map<string, Unsubscribe>();
  private remoteDecisionSubs = new Map<string, Unsubscribe>();
  private remoteCommentArtifacts = new Set<string>();
  private remoteDecisionArtifacts = new Set<string>();
  private remoteComments = new Map<string, ArtifactComment[]>();
  private remoteDecisions = new Map<string, ArtifactReviewDecision[]>();

  private mergedCommentsMemo = new Map<string, ArtifactComment[]>();
  private mergedDecisionsMemo = new Map<string, ArtifactReviewDecision[]>();

  constructor(
    private readonly local: LocalArtifactReviewRepository,
    private readonly remote?: FirestoreArtifactReviewRepository,
  ) {
    // Forward local mutations into the global change signal.
    this.local.subscribe(() => this.notifyGlobal());
  }

  /* ---- change signal ---- */

  subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyGlobal(): void {
    this.mergedCommentsMemo.clear();
    this.mergedDecisionsMemo.clear();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* ignore listener errors */
      }
    }
  }

  private remoteWritable(): boolean {
    return this.remote != null && this.remote.isWritable();
  }

  /* ---- sync state ---- */

  // Stable default objects so `useSyncExternalStore` snapshots never tear.
  private static readonly DEFAULT_LOCAL_ONLY: ReviewSyncState = { status: 'local-only', pendingCount: 0 };
  private static readonly DEFAULT_OFFLINE: ReviewSyncState = { status: 'offline', pendingCount: 0 };
  private static readonly DEFAULT_SYNCED: ReviewSyncState = { status: 'synced', pendingCount: 0 };

  getSyncState(artifactId: string): ReviewSyncState {
    const stored = this.syncStates.get(artifactId);
    if (stored) return stored;
    if (!this.remoteWritable()) return HybridArtifactReviewRepository.DEFAULT_LOCAL_ONLY;
    if (!isOnline()) return HybridArtifactReviewRepository.DEFAULT_OFFLINE;
    return HybridArtifactReviewRepository.DEFAULT_SYNCED;
  }

  private patchSyncState(artifactId: string, patch: Partial<ReviewSyncState>): void {
    const current = this.getSyncState(artifactId);
    this.syncStates.set(artifactId, { ...current, ...patch });
    this.notifyGlobal();
  }

  /* ---- cached reads ---- */

  getCachedComments(artifactId: string): ArtifactComment[] {
    const localComments = this.local.getCommentsSync(artifactId);
    if (!this.remoteCommentArtifacts.has(artifactId)) return localComments;
    const memo = this.mergedCommentsMemo.get(artifactId);
    if (memo) return memo;
    const merged = mergeComments(localComments, this.remoteComments.get(artifactId) ?? []);
    this.mergedCommentsMemo.set(artifactId, merged);
    return merged;
  }

  getCachedDecisions(artifactId: string): ArtifactReviewDecision[] {
    const localDecisions = this.local.getDecisionsSync(artifactId);
    if (!this.remoteDecisionArtifacts.has(artifactId)) return localDecisions;
    const memo = this.mergedDecisionsMemo.get(artifactId);
    if (memo) return memo;
    const merged = mergeDecisions(localDecisions, this.remoteDecisions.get(artifactId) ?? []);
    this.mergedDecisionsMemo.set(artifactId, merged);
    return merged;
  }

  /* ---- remote subscriptions ---- */

  private ensureRemoteComments(projectId: string, artifactId: string): void {
    if (!this.remote || !this.remote.isWritable()) return;
    const key = `${projectId}:${artifactId}`;
    if (this.remoteCommentSubs.has(key)) return;
    this.remoteCommentArtifacts.add(artifactId);
    const unsub = this.remote.subscribeComments(projectId, artifactId, (comments) => {
      this.remoteComments.set(artifactId, comments);
      this.patchSyncState(artifactId, { status: 'synced', lastSyncedAt: new Date().toISOString() });
    });
    this.remoteCommentSubs.set(key, unsub);
  }

  private ensureRemoteDecisions(projectId: string, artifactId: string): void {
    if (!this.remote || !this.remote.isWritable()) return;
    const key = `${projectId}:${artifactId}`;
    if (this.remoteDecisionSubs.has(key)) return;
    this.remoteDecisionArtifacts.add(artifactId);
    const unsub = this.remote.subscribeDecisions(projectId, artifactId, (decisions) => {
      this.remoteDecisions.set(artifactId, decisions);
      this.notifyGlobal();
    });
    this.remoteDecisionSubs.set(key, unsub);
  }

  subscribeComments(
    projectId: string,
    artifactId: string,
    callback: (comments: ArtifactComment[]) => void,
  ): Unsubscribe {
    this.ensureRemoteComments(projectId, artifactId);
    const emit = () => callback(this.getCachedComments(artifactId));
    emit();
    return this.subscribe(emit);
  }

  subscribeDecisions(
    projectId: string,
    artifactId: string,
    callback: (decisions: ArtifactReviewDecision[]) => void,
  ): Unsubscribe {
    this.ensureRemoteDecisions(projectId, artifactId);
    const emit = () => callback(this.getCachedDecisions(artifactId));
    emit();
    return this.subscribe(emit);
  }

  listComments(projectId: string, artifactId: string): Promise<ArtifactComment[]> {
    this.ensureRemoteComments(projectId, artifactId);
    return Promise.resolve(this.getCachedComments(artifactId));
  }

  listDecisions(projectId: string, artifactId: string): Promise<ArtifactReviewDecision[]> {
    this.ensureRemoteDecisions(projectId, artifactId);
    return Promise.resolve(this.getCachedDecisions(artifactId));
  }

  latestStatus(
    _projectId: string,
    artifactId: string,
  ): Promise<ArtifactReviewStatus | undefined> {
    const decisions = this.getCachedDecisions(artifactId);
    return Promise.resolve(
      decisions.length > 0 ? decisions[decisions.length - 1].status : undefined,
    );
  }

  /* ---- remote write helper ---- */

  private async syncRemote(
    artifactId: string,
    operationName: string,
    operationId: string,
    push: () => Promise<void>,
    onSynced: () => void,
  ): Promise<void> {
    if (!this.remoteWritable()) return;
    if (!isOnline()) {
      const state = this.getSyncState(artifactId);
      this.patchSyncState(artifactId, {
        status: 'offline',
        pendingCount: state.pendingCount + 1,
      });
      observabilityService.recordWarning({
        source: 'operation',
        title: 'Revisión guardada localmente (offline)',
        message: `${operationName} se guardó en este dispositivo y se sincronizará al recuperar conexión.`,
        operationId,
        metadata: { artifactId },
      });
      return;
    }
    const before = this.getSyncState(artifactId);
    this.patchSyncState(artifactId, {
      status: 'syncing',
      pendingCount: before.pendingCount + 1,
    });
    try {
      await push();
      onSynced();
      const after = this.getSyncState(artifactId);
      this.patchSyncState(artifactId, {
        status: 'synced',
        pendingCount: Math.max(0, after.pendingCount - 1),
        lastSyncedAt: new Date().toISOString(),
        lastError: undefined,
      });
      observabilityService.trackEvent({
        severity: 'success',
        source: 'operation',
        status: 'succeeded',
        title: 'Revisión sincronizada',
        message: `${operationName} se sincronizó con Firestore.`,
        operationId,
        recoverable: true,
        userVisible: false,
        metadata: { artifactId },
      });
    } catch (error) {
      const after = this.getSyncState(artifactId);
      this.patchSyncState(artifactId, {
        status: 'sync-error',
        pendingCount: Math.max(0, after.pendingCount - 1),
        lastError: errorMessage(error),
      });
      observabilityService.reportError(error, {
        source: 'operation',
        title: 'Fallo al sincronizar revisión',
        message: `${operationName} no pudo sincronizarse; los datos están a salvo localmente.`,
        operationId,
        recoverable: true,
        userVisible: false,
        metadata: { artifactId },
      });
    }
  }

  /* ---- comment mutations ---- */

  addCommentSync(input: AddCommentInput): ArtifactComment {
    const comment = this.local.addCommentSync(input);
    void this.syncRemote(
      comment.artifactId,
      'Comentario',
      createOperationId('review-add-comment'),
      () => this.remote!.saveComment(comment),
      () => this.local.markCommentSyncedSync(comment.id),
    );
    return comment;
  }

  async addComment(input: AddCommentInput): Promise<ArtifactComment> {
    const comment = this.local.addCommentSync(input);
    await this.syncRemote(
      comment.artifactId,
      'Comentario',
      createOperationId('review-add-comment'),
      () => this.remote!.saveComment(comment),
      () => this.local.markCommentSyncedSync(comment.id),
    );
    return comment;
  }

  replyToCommentSync(input: ReplyInput) {
    const reply = this.local.replyToCommentSync(input);
    const updated = this.local.getCommentsSync(input.artifactId).find((c) => c.id === input.commentId);
    if (updated) {
      void this.syncRemote(
        input.artifactId,
        'Respuesta',
        createOperationId('review-reply'),
        () => this.remote!.saveComment(updated),
        () => undefined,
      );
    }
    return reply;
  }

  async replyToComment(input: ReplyInput) {
    return this.replyToCommentSync(input);
  }

  setCommentStatusSync(input: SetCommentStatusInput): ArtifactComment {
    const updated = this.local.setCommentStatusSync(input);
    void this.syncRemote(
      input.artifactId,
      input.status === 'resolved' ? 'Resolución de comentario' : 'Reapertura de comentario',
      createOperationId('review-comment-status'),
      () => this.remote!.saveComment(updated),
      () => undefined,
    );
    return updated;
  }

  async setCommentStatus(input: SetCommentStatusInput): Promise<ArtifactComment> {
    return this.setCommentStatusSync(input);
  }

  deleteCommentSync(input: DeleteCommentInput): void {
    this.local.deleteCommentSync(input);
    void this.syncRemote(
      input.artifactId,
      'Eliminación de comentario',
      createOperationId('review-delete-comment'),
      () => this.remote!.deleteComment(input),
      () => undefined,
    );
  }

  async deleteComment(input: DeleteCommentInput): Promise<void> {
    this.deleteCommentSync(input);
  }

  /* ---- decision mutations ---- */

  recordDecisionSync(input: RecordDecisionInput): ArtifactReviewDecision {
    const operationId = input.operationId ?? createOperationId('review-decision');
    const decision = this.local.recordDecisionSync({ ...input, operationId });
    void this.syncRemote(
      decision.artifactId,
      'Decisión de revisión',
      operationId,
      () => this.remote!.saveDecision(decision),
      () => this.local.markDecisionSyncedSync(decision.id),
    );
    return decision;
  }

  async recordDecision(input: RecordDecisionInput): Promise<ArtifactReviewDecision> {
    return this.recordDecisionSync(input);
  }

  /* ---- migration ---- */

  /**
   * Push pre-existing local records to Firestore. Idempotent: records already
   * flagged `synced` are skipped, and writes use the record id so a re-run
   * never duplicates.
   */
  async migrateLocalToRemote(): Promise<ReviewMigrationReport> {
    const report: ReviewMigrationReport = {
      attempted: 0,
      migratedComments: 0,
      migratedDecisions: 0,
      skippedDuplicates: 0,
      failed: 0,
      errors: [],
    };
    if (!this.remote || !this.remote.isWritable()) {
      report.errors.push('Firestore no disponible o usuario no autenticado.');
      return report;
    }
    const operationId = createOperationId('review-migration');

    for (const comment of this.local.getAllCommentsSync()) {
      if (comment.source === 'synced') {
        report.skippedDuplicates += 1;
        continue;
      }
      report.attempted += 1;
      try {
        await this.remote.saveComment({ ...comment, source: 'synced' });
        this.local.markCommentSyncedSync(comment.id);
        report.migratedComments += 1;
      } catch (error) {
        report.failed += 1;
        report.errors.push(`comment ${comment.id}: ${errorMessage(error)}`);
      }
    }

    for (const decision of this.local.getAllDecisionsSync()) {
      if (decision.source === 'synced') {
        report.skippedDuplicates += 1;
        continue;
      }
      report.attempted += 1;
      try {
        await this.remote.saveDecision({ ...decision, source: 'synced' });
        this.local.markDecisionSyncedSync(decision.id);
        report.migratedDecisions += 1;
      } catch (error) {
        report.failed += 1;
        report.errors.push(`decision ${decision.id}: ${errorMessage(error)}`);
      }
    }

    observabilityService.trackEvent({
      severity: report.failed > 0 ? 'warning' : 'success',
      source: 'operation',
      status: report.failed > 0 ? 'observed' : 'succeeded',
      title: 'Migración de revisión local → Firestore',
      message:
        `Migrados ${report.migratedComments} comentarios y ${report.migratedDecisions} decisiones; ` +
        `${report.skippedDuplicates} ya sincronizados, ${report.failed} con error.`,
      operationId,
      recoverable: true,
      userVisible: false,
      metadata: {
        migratedComments: report.migratedComments,
        migratedDecisions: report.migratedDecisions,
        failed: report.failed,
      },
    });
    if (report.attempted > 0 || report.failed > 0) this.notifyGlobal();
    return report;
  }

  /** Start remote sync for an artifact without registering a UI listener. */
  startRemoteSync(projectId: string, artifactId: string): void {
    this.ensureRemoteComments(projectId, artifactId);
    this.ensureRemoteDecisions(projectId, artifactId);
  }

  /** Locate a comment by id across every artifact (local is authoritative). */
  findComment(commentId: string): ArtifactComment | undefined {
    return this.local.getAllCommentsSync().find((c) => c.id === commentId);
  }

  /** Tear down every active remote subscription (call on teardown). */
  dispose(): void {
    for (const unsub of this.remoteCommentSubs.values()) unsub();
    for (const unsub of this.remoteDecisionSubs.values()) unsub();
    this.remoteCommentSubs.clear();
    this.remoteDecisionSubs.clear();
  }
}

/**
 * Artifact review service — collaborative review façade.
 *
 * Phase 2: this is now a thin **synchronous façade** over the review
 * repository layer (`services/review`). The repository is a
 * `HybridArtifactReviewRepository` — local-first (localStorage) with
 * best-effort Firestore synchronisation.
 *
 * The public API is intentionally kept synchronous and backwards compatible so
 * the existing `useSyncExternalStore`-based UI (`CommentThread`, `ReviewPanel`,
 * `ArtifactInspectorPanel`) keeps working without changes:
 *  - reads return the repository's cached snapshot (stable references),
 *  - mutations apply locally and instantly, then sync remotely in the
 *    background.
 *
 * New surface: `ensureSynced` (start remote sync for an artifact) and
 * `getSyncState` (sync-status for the UI badge).
 */

import type {
    ArtifactComment,
    ArtifactCommentAnchor,
    ArtifactCommentAuthor,
    ArtifactCommentReply,
    ArtifactCommentStatus,
    ArtifactReviewDecision,
    ArtifactReviewStatus,
} from './ReviewTypes';
import { createDefaultReviewRepository } from './index';
import type {
    AddCommentInput,
    RecordDecisionInput,
    ReviewMigrationReport,
    ReviewSyncState,
} from './types';
import type { HybridArtifactReviewRepository } from './hybridArtifactReviewRepository';
import {
    InvalidReviewTransitionError,
    canTransitionReviewStatus,
} from './reviewTransitions';

type Listener = () => void;

/** Fallback actor when a caller resolves a comment without identifying itself. */
const SYSTEM_ACTOR: ArtifactCommentAuthor = { id: 'local-reviewer', name: 'Revisor' };

class ArtifactReviewStore {
    private repository: HybridArtifactReviewRepository = createDefaultReviewRepository();
    /** (projectId:artifactId) pairs whose remote sync has been started. */
    private synced = new Set<string>();
    private migrationStarted = false;

    /** Exposed for tests / advanced callers that need the repository directly. */
    getRepository(): HybridArtifactReviewRepository {
        return this.repository;
    }

    subscribe(listener: Listener): () => void {
        return this.repository.subscribe(listener);
    }

    /**
     * Start remote (Firestore) synchronisation for an artifact and trigger a
     * one-time local→remote migration. Safe to call repeatedly (idempotent);
     * call it from a component effect once the artifact is known.
     */
    ensureSynced(projectId: string, artifactId: string): void {
        const key = `${projectId}:${artifactId}`;
        if (!this.synced.has(key)) {
            this.synced.add(key);
            this.repository.startRemoteSync(projectId, artifactId);
        }
        this.maybeMigrate();
    }

    /** Current synchronisation state for an artifact (drives the sync badge). */
    getSyncState(artifactId: string): ReviewSyncState {
        return this.repository.getSyncState(artifactId);
    }

    /** Force a local→remote migration pass (also runs lazily via `ensureSynced`). */
    migrateLocalToRemote(): Promise<ReviewMigrationReport> {
        return this.repository.migrateLocalToRemote();
    }

    private maybeMigrate(): void {
        if (this.migrationStarted) return;
        this.migrationStarted = true;
        void this.repository.migrateLocalToRemote().catch(() => {
            // Migration failures are recorded by the repository's observability
            // hooks; they must never surface as an unhandled rejection.
        });
    }

    // ---- Comments ----

    listComments(artifactId: string): ArtifactComment[] {
        return this.repository.getCachedComments(artifactId);
    }

    listOpenCount(artifactId: string): number {
        return this.listComments(artifactId).filter((c) => c.status === 'open').length;
    }

    /**
     * Open-comment counts grouped by document-section id. Powers the
     * per-section badges in the document outline.
     */
    openCountsByDocumentSection(artifactId: string): Record<string, number> {
        const counts: Record<string, number> = {};
        for (const comment of this.listComments(artifactId)) {
            if (comment.status !== 'open') continue;
            if (comment.anchor.kind !== 'document-section') continue;
            const id = comment.anchor.sectionId;
            counts[id] = (counts[id] ?? 0) + 1;
        }
        return counts;
    }

    addComment(input: {
        artifactId: string;
        projectId: string;
        anchor: ArtifactCommentAnchor;
        body: string;
        author: ArtifactCommentAuthor;
        tags?: string[];
        visibility?: AddCommentInput['visibility'];
    }): ArtifactComment {
        return this.repository.addCommentSync(input);
    }

    replyToComment(
        commentId: string,
        body: string,
        author: ArtifactCommentAuthor,
    ): ArtifactCommentReply | null {
        const comment = this.repository.findComment(commentId);
        if (!comment) return null;
        return this.repository.replyToCommentSync({
            projectId: comment.projectId,
            artifactId: comment.artifactId,
            commentId,
            body,
            author,
        });
    }

    setCommentStatus(
        commentId: string,
        status: ArtifactCommentStatus,
        actor?: ArtifactCommentAuthor,
    ): boolean {
        const comment = this.repository.findComment(commentId);
        if (!comment) return false;
        this.repository.setCommentStatusSync({
            projectId: comment.projectId,
            artifactId: comment.artifactId,
            commentId,
            status,
            actor: actor ?? SYSTEM_ACTOR,
        });
        return true;
    }

    deleteComment(commentId: string): boolean {
        const comment = this.repository.findComment(commentId);
        if (!comment) return false;
        this.repository.deleteCommentSync({
            projectId: comment.projectId,
            artifactId: comment.artifactId,
            commentId,
        });
        return true;
    }

    // ---- Decisions ----

    listDecisions(artifactId: string): ArtifactReviewDecision[] {
        return this.repository.getCachedDecisions(artifactId);
    }

    /**
     * Record a status transition. The latest decision determines the
     * effective `reviewStatus` for the artifact when AppContext reads it.
     */
    /**
     * Record a review decision.
     *
     * This is the single choke point every review UI goes through, so the
     * transition guard lives here. `previousStatus` is resolved from the
     * decision log rather than trusted from the caller: a caller-supplied
     * "previous" status is exactly how a log drifts from reality.
     *
     * @throws {InvalidReviewTransitionError} when the move is not allowed.
     */
    recordDecision(input: {
        artifactId: string;
        projectId: string;
        status: ArtifactReviewStatus;
        rationale?: string;
        author: ArtifactCommentAuthor;
        previousStatus?: ArtifactReviewStatus;
    }): ArtifactReviewDecision {
        const previousStatus = this.latestStatus(input.artifactId) ?? input.previousStatus;
        if (!canTransitionReviewStatus(previousStatus, input.status)) {
            throw new InvalidReviewTransitionError(previousStatus, input.status);
        }
        return this.repository.recordDecisionSync({
            ...input,
            previousStatus,
        } as RecordDecisionInput);
    }

    latestStatus(artifactId: string): ArtifactReviewStatus | undefined {
        const decisions = this.repository.getCachedDecisions(artifactId);
        return decisions.length > 0 ? decisions[decisions.length - 1].status : undefined;
    }
}

export const artifactReviewService = new ArtifactReviewStore();

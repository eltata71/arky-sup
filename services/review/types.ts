/**
 * Artifact review persistence — repository contracts.
 *
 * Defines the `ArtifactReviewRepository` abstraction shared by the local,
 * Firestore and hybrid implementations, plus the input shapes and the
 * synchronisation-state model surfaced to the UI.
 *
 * The repository layer is the single source of truth for collaborative
 * review data (comments + review decisions). `artifactReviewService` is a
 * thin synchronous façade over it so existing UI code keeps working.
 */

import type {
  ArtifactComment,
  ArtifactCommentAnchor,
  ArtifactCommentAuthor,
  ArtifactCommentReply,
  ArtifactCommentStatus,
  ArtifactCommentVisibility,
  ArtifactReviewDecision,
  ArtifactReviewStatus,
} from './ReviewTypes';

export type Unsubscribe = () => void;

/* ----------------------------------------------------------------------- */
/* Synchronisation state                                                   */
/* ----------------------------------------------------------------------- */

export type ReviewSyncStatus =
  | 'local-only' // no remote backend configured
  | 'syncing' // a remote write is in flight
  | 'synced' // local and remote agree
  | 'sync-error' // a remote write failed; data is safe locally
  | 'offline'; // device is offline; writes are queued locally

export interface ReviewSyncState {
  status: ReviewSyncStatus;
  /** Records created/updated locally but not yet confirmed remotely. */
  pendingCount: number;
  /** ISO timestamp of the last successful remote sync. */
  lastSyncedAt?: string;
  /** Human-readable description of the last sync error. */
  lastError?: string;
}

export const LOCAL_ONLY_SYNC_STATE: ReviewSyncState = {
  status: 'local-only',
  pendingCount: 0,
};

/* ----------------------------------------------------------------------- */
/* Repository inputs                                                        */
/* ----------------------------------------------------------------------- */

export interface AddCommentInput {
  /** Optional pre-assigned id (used by the façade + idempotent migration). */
  id?: string;
  /** Optional pre-assigned creation timestamp. */
  createdAt?: string;
  projectId: string;
  artifactId: string;
  anchor: ArtifactCommentAnchor;
  body: string;
  author: ArtifactCommentAuthor;
  tags?: string[];
  visibility?: ArtifactCommentVisibility;
}

export interface ReplyInput {
  id?: string;
  projectId: string;
  artifactId: string;
  commentId: string;
  body: string;
  author: ArtifactCommentAuthor;
}

export interface SetCommentStatusInput {
  projectId: string;
  artifactId: string;
  commentId: string;
  status: ArtifactCommentStatus;
  /** Who performed the transition — stamped as `resolvedBy` when resolving. */
  actor: ArtifactCommentAuthor;
}

export interface DeleteCommentInput {
  projectId: string;
  artifactId: string;
  commentId: string;
}

export interface RecordDecisionInput {
  id?: string;
  projectId: string;
  artifactId: string;
  status: ArtifactReviewStatus;
  rationale?: string;
  author: ArtifactCommentAuthor;
  /** Status before the transition; computed by the caller when known. */
  previousStatus?: ArtifactReviewStatus;
  operationId?: string;
}

/* ----------------------------------------------------------------------- */
/* Repository contract                                                      */
/* ----------------------------------------------------------------------- */

export type ReviewRepositoryKind = 'local' | 'remote' | 'hybrid';

/**
 * The canonical async repository contract. Every persistence backend
 * implements exactly these operations.
 */
export interface ArtifactReviewRepository {
  readonly kind: ReviewRepositoryKind;

  listComments(projectId: string, artifactId: string): Promise<ArtifactComment[]>;
  subscribeComments(
    projectId: string,
    artifactId: string,
    callback: (comments: ArtifactComment[]) => void,
  ): Unsubscribe;
  addComment(input: AddCommentInput): Promise<ArtifactComment>;
  replyToComment(input: ReplyInput): Promise<ArtifactCommentReply>;
  setCommentStatus(input: SetCommentStatusInput): Promise<ArtifactComment>;
  deleteComment(input: DeleteCommentInput): Promise<void>;

  listDecisions(projectId: string, artifactId: string): Promise<ArtifactReviewDecision[]>;
  subscribeDecisions(
    projectId: string,
    artifactId: string,
    callback: (decisions: ArtifactReviewDecision[]) => void,
  ): Unsubscribe;
  recordDecision(input: RecordDecisionInput): Promise<ArtifactReviewDecision>;
  latestStatus(projectId: string, artifactId: string): Promise<ArtifactReviewStatus | undefined>;
}

/**
 * A repository that also exposes synchronous cached reads + a global change
 * signal. This is the bridge that lets a synchronous `useSyncExternalStore`
 * façade sit on top of an otherwise async repository without tearing.
 */
export interface SyncAwareReviewRepository extends ArtifactReviewRepository {
  /** Register for any change to any artifact's review data. */
  subscribe(listener: () => void): Unsubscribe;
  /** Synchronous cached snapshot (stable reference between changes). */
  getCachedComments(artifactId: string): ArtifactComment[];
  getCachedDecisions(artifactId: string): ArtifactReviewDecision[];
  /** Current sync state for an artifact. */
  getSyncState(artifactId: string): ReviewSyncState;
}

/** Outcome of a local → remote migration pass. */
export interface ReviewMigrationReport {
  attempted: number;
  migratedComments: number;
  migratedDecisions: number;
  skippedDuplicates: number;
  failed: number;
  errors: string[];
}

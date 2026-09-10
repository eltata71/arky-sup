/**
 * The review vocabulary: a suggestion, a comment thread, a decision.
 *
 * These ten declarations are the `review` context's model and nothing else's.
 * They lived in the root `types.ts`, which is why a change to a comment's
 * anchor recompiled the Training Center. `services/review` owns the
 * repositories, the transitions and the sync state; it should own the shape of
 * what it stores.
 *
 * Re-exported from `types.ts` for existing callers.
 */

export interface ArtifactReviewSuggestion {
  id: string;
  title: string;
  description: string;
  category: 'Security' | 'Performance' | 'Scalability' | 'Best Practices' | 'Clarity';
}

// --- Collaborative review (Phase 1: local persistence, multi-user-ready) ---

/**
 * Workflow status of an artifact within the review/approval cycle. Stored on
 * Artifact.reviewStatus and shown in the unified status badge.
 */
export type ArtifactReviewStatus =
  | 'draft'              // recién generado o editado, no enviado a revisión
  | 'pending-review'     // enviado, esperando aprobación
  | 'changes-requested'  // un reviewer pidió cambios
  | 'approved'           // aprobado, listo para uso
  | 'rejected';          // rechazado definitivamente

/** Where a comment is anchored inside an artifact. */
export type ArtifactCommentAnchor =
  | { kind: 'artifact' }
  | { kind: 'document-section'; sectionId: string; sectionTitle?: string }
  | { kind: 'diagram-node'; nodeId: string }
  | { kind: 'diagram-edge'; edgeId: string };

export type ArtifactCommentStatus = 'open' | 'resolved';

/**
 * Persistence provenance of a review record.
 *  - `local`  — created locally, not yet pushed to a remote backend.
 *  - `remote` — originated from the remote backend (Firestore).
 *  - `synced` — created locally and confirmed persisted remotely.
 */
export type ArtifactReviewRecordSource = 'local' | 'remote' | 'synced';

/** Who can see a comment. Reserved for future per-team scoping. */
export type ArtifactCommentVisibility = 'team' | 'private';

export interface ArtifactCommentAuthor {
  id: string;
  name: string;
  /** Optional display avatar URL. */
  avatarUrl?: string;
}

export interface ArtifactCommentReply {
  id: string;
  body: string;
  createdAt: string;
  author: ArtifactCommentAuthor;
}

export interface ArtifactComment {
  id: string;
  artifactId: string;
  projectId: string;
  anchor: ArtifactCommentAnchor;
  body: string;
  status: ArtifactCommentStatus;
  createdAt: string;
  updatedAt: string;
  author: ArtifactCommentAuthor;
  replies: ArtifactCommentReply[];
  /** Free-form labels (e.g. "blocker", "security"). */
  tags?: string[];
  /** ISO timestamp when the comment was resolved. */
  resolvedAt?: string;
  /** Who resolved the comment. */
  resolvedBy?: ArtifactCommentAuthor;
  /** Visibility scope. Defaults to `team`. */
  visibility?: ArtifactCommentVisibility;
  /** Persistence provenance. Defaults to `local`. */
  source?: ArtifactReviewRecordSource;
}

/** Architectural decision recorded against an artifact (ADR-lite). */
export interface ArtifactReviewDecision {
  id: string;
  artifactId: string;
  projectId: string;
  status: ArtifactReviewStatus;
  rationale?: string;
  decidedAt: string;
  author: ArtifactCommentAuthor;
  /** Status the artifact held immediately before this decision. */
  previousStatus?: ArtifactReviewStatus;
  /** Stable id correlating this decision across local + remote + observability. */
  operationId?: string;
  /** Persistence provenance. Defaults to `local`. */
  source?: ArtifactReviewRecordSource;
}

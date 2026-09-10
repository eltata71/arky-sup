/**
 * FirestoreArtifactReviewRepository — remote review persistence.
 *
 * Firestore layout:
 *   projects/{projectId}/artifacts/{artifactId}/comments/{commentId}
 *   projects/{projectId}/artifacts/{artifactId}/reviewDecisions/{decisionId}
 *
 * All Firestore access is funnelled through an injectable `ReviewFirestore
 * Gateway` so the repository is unit-testable with an in-memory fake and the
 * production wiring stays in one place.
 *
 * Writes require an authenticated user; the gateway refuses otherwise. The
 * `author` is always taken from the caller's authenticated profile — the
 * Firestore security rules (see `firestore.rules`) are the real enforcement.
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import type {
  ArtifactComment,
  ArtifactCommentReply,
  ArtifactReviewDecision,
  ArtifactReviewStatus,
} from '../../types';
import { auth, db as firestore, isFirebaseAvailable } from '../../firebase';
// `db` es `Firestore | null`: sin configuración de Firebase la aplicación
// arranca igual y funciona contra `localStorage`. Este repositorio lo asumía no
// nulo, como todos los demás antes de la Ola 2, y el `strict` lo dijo al entrar
// en su cierre transitivo. Sin la guarda, `doc(null, …)` lanza un `TypeError`
// que el `catch` de turno convierte en un fallo genérico y esconde la causa.
import { requireDb } from '../persistence';
import { sanitizeForFirestore } from '../../lib/firestoreData';
import {
  newCommentId,
  newDecisionId,
  newReplyId,
} from './localArtifactReviewRepository';
import type {
  AddCommentInput,
  ArtifactReviewRepository,
  DeleteCommentInput,
  RecordDecisionInput,
  ReplyInput,
  SetCommentStatusInput,
  Unsubscribe,
} from './types';

const COMMENTS_SUBCOLLECTION = 'comments';
const DECISIONS_SUBCOLLECTION = 'reviewDecisions';

/** Narrow seam over Firestore so the repository can be faked in tests. */
export interface ReviewFirestoreGateway {
  isAvailable(): boolean;
  currentUserId(): string | null;
  fetchComments(projectId: string, artifactId: string): Promise<ArtifactComment[]>;
  watchComments(
    projectId: string,
    artifactId: string,
    onData: (comments: ArtifactComment[]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe;
  upsertComment(projectId: string, artifactId: string, comment: ArtifactComment): Promise<void>;
  removeComment(projectId: string, artifactId: string, commentId: string): Promise<void>;
  fetchDecisions(projectId: string, artifactId: string): Promise<ArtifactReviewDecision[]>;
  watchDecisions(
    projectId: string,
    artifactId: string,
    onData: (decisions: ArtifactReviewDecision[]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe;
  upsertDecision(projectId: string, artifactId: string, decision: ArtifactReviewDecision): Promise<void>;
}

/** Production gateway backed by the real Firestore SDK. */
export function createFirestoreReviewGateway(): ReviewFirestoreGateway {
  const commentsRef = (projectId: string, artifactId: string) =>
    collection(requireDb(firestore), 'projects', projectId, 'artifacts', artifactId, COMMENTS_SUBCOLLECTION);
  const decisionsRef = (projectId: string, artifactId: string) =>
    collection(requireDb(firestore), 'projects', projectId, 'artifacts', artifactId, DECISIONS_SUBCOLLECTION);

  return {
    isAvailable: () => isFirebaseAvailable && firestore != null,
    currentUserId: () => auth?.currentUser?.uid ?? null,

    async fetchComments(projectId, artifactId) {
      const snap = await getDocs(commentsRef(projectId, artifactId));
      return snap.docs.map((d) => ({ ...(d.data() as ArtifactComment), source: 'remote' }));
    },
    watchComments(projectId, artifactId, onData, onError) {
      return onSnapshot(
        commentsRef(projectId, artifactId),
        (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as ArtifactComment), source: 'remote' }))),
        onError,
      );
    },
    async upsertComment(projectId, artifactId, comment) {
      await setDoc(
        doc(requireDb(firestore), 'projects', projectId, 'artifacts', artifactId, COMMENTS_SUBCOLLECTION, comment.id),
        sanitizeForFirestore({ ...comment, source: 'synced' }),
      );
    },
    async removeComment(projectId, artifactId, commentId) {
      await deleteDoc(
        doc(requireDb(firestore), 'projects', projectId, 'artifacts', artifactId, COMMENTS_SUBCOLLECTION, commentId),
      );
    },

    async fetchDecisions(projectId, artifactId) {
      const snap = await getDocs(decisionsRef(projectId, artifactId));
      return snap.docs.map((d) => ({ ...(d.data() as ArtifactReviewDecision), source: 'remote' }));
    },
    watchDecisions(projectId, artifactId, onData, onError) {
      return onSnapshot(
        decisionsRef(projectId, artifactId),
        (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as ArtifactReviewDecision), source: 'remote' }))),
        onError,
      );
    },
    async upsertDecision(projectId, artifactId, decision) {
      await setDoc(
        doc(requireDb(firestore), 'projects', projectId, 'artifacts', artifactId, DECISIONS_SUBCOLLECTION, decision.id),
        sanitizeForFirestore({ ...decision, source: 'synced' }),
      );
    },
  };
}

const sortByCreatedAt = (a: ArtifactComment, b: ArtifactComment): number =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;

const sortByDecidedAt = (a: ArtifactReviewDecision, b: ArtifactReviewDecision): number =>
  a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : 0;

export class FirestoreArtifactReviewRepository implements ArtifactReviewRepository {
  readonly kind = 'firestore' as const;

  constructor(private readonly gateway: ReviewFirestoreGateway) {}

  /** Available only when Firebase is configured and a user is signed in. */
  isWritable(): boolean {
    return this.gateway.isAvailable() && this.gateway.currentUserId() != null;
  }

  private assertWritable(): void {
    if (!this.gateway.isAvailable()) {
      throw new Error('Firestore no está disponible.');
    }
    if (this.gateway.currentUserId() == null) {
      throw new Error('Se requiere un usuario autenticado para escribir reseñas.');
    }
  }

  async listComments(projectId: string, artifactId: string): Promise<ArtifactComment[]> {
    if (!this.gateway.isAvailable()) throw new Error('Firestore no está disponible.');
    const comments = await this.gateway.fetchComments(projectId, artifactId);
    return comments.slice().sort(sortByCreatedAt);
  }

  subscribeComments(
    projectId: string,
    artifactId: string,
    callback: (comments: ArtifactComment[]) => void,
  ): Unsubscribe {
    if (!this.gateway.isAvailable()) return () => undefined;
    return this.gateway.watchComments(
      projectId,
      artifactId,
      (comments) => callback(comments.slice().sort(sortByCreatedAt)),
      () => undefined,
    );
  }

  async addComment(input: AddCommentInput): Promise<ArtifactComment> {
    this.assertWritable();
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
      source: 'synced',
    };
    await this.gateway.upsertComment(input.projectId, input.artifactId, comment);
    return comment;
  }

  async replyToComment(input: ReplyInput): Promise<ArtifactCommentReply> {
    this.assertWritable();
    const comments = await this.gateway.fetchComments(input.projectId, input.artifactId);
    const comment = comments.find((c) => c.id === input.commentId);
    if (!comment) throw new Error(`Comment ${input.commentId} not found`);
    const reply: ArtifactCommentReply = {
      id: input.id ?? newReplyId(),
      body: input.body.trim(),
      createdAt: new Date().toISOString(),
      author: input.author,
    };
    if (comment.replies.some((r) => r.id === reply.id)) return reply;
    await this.gateway.upsertComment(input.projectId, input.artifactId, {
      ...comment,
      replies: [...comment.replies, reply],
      updatedAt: reply.createdAt,
    });
    return reply;
  }

  async setCommentStatus(input: SetCommentStatusInput): Promise<ArtifactComment> {
    this.assertWritable();
    const comments = await this.gateway.fetchComments(input.projectId, input.artifactId);
    const comment = comments.find((c) => c.id === input.commentId);
    if (!comment) throw new Error(`Comment ${input.commentId} not found`);
    const now = new Date().toISOString();
    const resolved = input.status === 'resolved';
    const next: ArtifactComment = {
      ...comment,
      status: input.status,
      updatedAt: now,
      resolvedAt: resolved ? now : undefined,
      resolvedBy: resolved ? input.actor : undefined,
    };
    await this.gateway.upsertComment(input.projectId, input.artifactId, next);
    return next;
  }

  async deleteComment(input: DeleteCommentInput): Promise<void> {
    this.assertWritable();
    await this.gateway.removeComment(input.projectId, input.artifactId, input.commentId);
  }

  /** Raw upsert of a fully-formed comment — preserves replies/status during migration. */
  async saveComment(comment: ArtifactComment): Promise<void> {
    this.assertWritable();
    await this.gateway.upsertComment(comment.projectId, comment.artifactId, comment);
  }

  /** Raw upsert of a fully-formed decision — used during migration. */
  async saveDecision(decision: ArtifactReviewDecision): Promise<void> {
    this.assertWritable();
    await this.gateway.upsertDecision(decision.projectId, decision.artifactId, decision);
  }

  async listDecisions(projectId: string, artifactId: string): Promise<ArtifactReviewDecision[]> {
    if (!this.gateway.isAvailable()) throw new Error('Firestore no está disponible.');
    const decisions = await this.gateway.fetchDecisions(projectId, artifactId);
    return decisions.slice().sort(sortByDecidedAt);
  }

  subscribeDecisions(
    projectId: string,
    artifactId: string,
    callback: (decisions: ArtifactReviewDecision[]) => void,
  ): Unsubscribe {
    if (!this.gateway.isAvailable()) return () => undefined;
    return this.gateway.watchDecisions(
      projectId,
      artifactId,
      (decisions) => callback(decisions.slice().sort(sortByDecidedAt)),
      () => undefined,
    );
  }

  async recordDecision(input: RecordDecisionInput): Promise<ArtifactReviewDecision> {
    this.assertWritable();
    const decision: ArtifactReviewDecision = {
      id: input.id ?? newDecisionId(),
      artifactId: input.artifactId,
      projectId: input.projectId,
      status: input.status,
      rationale: input.rationale,
      decidedAt: new Date().toISOString(),
      author: input.author,
      previousStatus: input.previousStatus,
      operationId: input.operationId,
      source: 'synced',
    };
    await this.gateway.upsertDecision(input.projectId, input.artifactId, decision);
    return decision;
  }

  async latestStatus(
    projectId: string,
    artifactId: string,
  ): Promise<ArtifactReviewStatus | undefined> {
    const decisions = await this.listDecisions(projectId, artifactId);
    return decisions.length > 0 ? decisions[decisions.length - 1].status : undefined;
  }
}

/**
 * RemoteArtifactReviewRepository — la revisión que queda guardada en el servidor.
 *
 * Dos tablas, y la diferencia entre ellas es el motivo por el que existe una
 * oficina de arquitectura:
 *
 *   api.artifact_comments          — un hilo se edita, se resuelve y se borra
 *   api.artifact_review_decisions  — una decisión se crea y nunca se toca
 *
 * `api.record_artifact_review_decision` hace `on conflict do nothing`: repetir
 * el id no falla y **no reescribe**. Es la mitad de servidor de lo que en
 * Firestore era `allow update: if false`, y sin ella el rastro de quién aprobó
 * qué sería una opinión con fecha.
 *
 * Todo el acceso pasa por un `ReviewRemoteGateway` inyectable, de modo que el
 * repositorio se prueba con un doble en memoria y el cableado de producción
 * vive en un solo sitio.
 *
 * **Las suscripciones no son tiempo real, y se dice en voz alta.** Firestore
 * traía `onSnapshot`; aquí las tablas están cerradas por defecto y Realtime no
 * las publica. `subscribe*` hace una lectura y entrega una vez. Un panel que
 * cree estar suscrito y no lo esté es peor que uno que sabe que no lo está: el
 * repositorio híbrido sigue emitiendo los cambios locales, que es lo que la
 * persona que escribe necesita ver de inmediato.
 */

import type {
  ArtifactComment,
  ArtifactCommentReply,
  ArtifactReviewDecision,
  ArtifactReviewStatus,
} from '../../types';
import { callRpc, isSupabaseDataBackendConfigured } from '../adapters';
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

/** Narrow seam over the database so the repository can be faked in tests. */
export interface ReviewRemoteGateway {
  isAvailable(): boolean;
  currentUserId(): string | null;
  fetchComments(projectId: string, artifactId: string): Promise<ArtifactComment[]>;
  upsertComment(projectId: string, artifactId: string, comment: ArtifactComment): Promise<void>;
  removeComment(projectId: string, artifactId: string, commentId: string): Promise<void>;
  fetchDecisions(projectId: string, artifactId: string): Promise<ArtifactReviewDecision[]>;
  upsertDecision(projectId: string, artifactId: string, decision: ArtifactReviewDecision): Promise<void>;
}

const asList = <T>(rows: unknown, source: 'remote'): T[] =>
  (Array.isArray(rows) ? rows : []).map((row) => ({ ...(row as T), source }));

/** Production gateway backed by the real RPC surface. */
export function createRemoteReviewGateway(
  currentUserId: () => string | null,
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): ReviewRemoteGateway {
  return {
    isAvailable: () => isSupabaseDataBackendConfigured(env),
    currentUserId,

    async fetchComments(projectId, artifactId) {
      return asList<ArtifactComment>(
        await callRpc('list_artifact_comments', { p_project_id: projectId, p_artifact_id: artifactId }),
        'remote',
      );
    },
    async upsertComment(_projectId, _artifactId, comment) {
      await callRpc('save_artifact_comment', { p_comment: { ...comment, source: 'synced' } });
    },
    async removeComment(_projectId, _artifactId, commentId) {
      await callRpc('delete_artifact_comment', { p_comment_id: commentId });
    },

    async fetchDecisions(projectId, artifactId) {
      return asList<ArtifactReviewDecision>(
        await callRpc('list_artifact_review_decisions', { p_project_id: projectId, p_artifact_id: artifactId }),
        'remote',
      );
    },
    async upsertDecision(_projectId, _artifactId, decision) {
      await callRpc('record_artifact_review_decision', { p_decision: { ...decision, source: 'synced' } });
    },
  };
}

const sortByCreatedAt = (a: ArtifactComment, b: ArtifactComment): number =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;

const sortByDecidedAt = (a: ArtifactReviewDecision, b: ArtifactReviewDecision): number =>
  a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : 0;

export class RemoteArtifactReviewRepository implements ArtifactReviewRepository {
  readonly kind = 'remote' as const;

  constructor(private readonly gateway: ReviewRemoteGateway) {}

  /** Available only when the backend is configured and a user is signed in. */
  isWritable(): boolean {
    return this.gateway.isAvailable() && this.gateway.currentUserId() != null;
  }

  private assertWritable(): void {
    if (!this.gateway.isAvailable()) {
      throw new Error('La base de datos no está disponible.');
    }
    if (this.gateway.currentUserId() == null) {
      throw new Error('Se requiere un usuario autenticado para escribir reseñas.');
    }
  }

  async listComments(projectId: string, artifactId: string): Promise<ArtifactComment[]> {
    if (!this.gateway.isAvailable()) throw new Error('La base de datos no está disponible.');
    const comments = await this.gateway.fetchComments(projectId, artifactId);
    return comments.slice().sort(sortByCreatedAt);
  }

  /**
   * Una entrega, no una suscripción. Ver la nota de cabecera: las tablas de
   * revisión no están publicadas por Realtime, y fingir un flujo continuo
   * dejaría un panel convencido de estar al día.
   */
  subscribeComments(
    projectId: string,
    artifactId: string,
    callback: (comments: ArtifactComment[]) => void,
  ): Unsubscribe {
    if (!this.gateway.isAvailable()) return () => undefined;
    let cancelled = false;
    void this.listComments(projectId, artifactId)
      .then((comments) => { if (!cancelled) callback(comments); })
      .catch(() => undefined);
    return () => { cancelled = true; };
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
    if (!this.gateway.isAvailable()) throw new Error('La base de datos no está disponible.');
    const decisions = await this.gateway.fetchDecisions(projectId, artifactId);
    return decisions.slice().sort(sortByDecidedAt);
  }

  subscribeDecisions(
    projectId: string,
    artifactId: string,
    callback: (decisions: ArtifactReviewDecision[]) => void,
  ): Unsubscribe {
    if (!this.gateway.isAvailable()) return () => undefined;
    let cancelled = false;
    void this.listDecisions(projectId, artifactId)
      .then((decisions) => { if (!cancelled) callback(decisions); })
      .catch(() => undefined);
    return () => { cancelled = true; };
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

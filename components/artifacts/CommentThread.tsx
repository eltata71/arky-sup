import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button, Badge, EmptyState } from '../ui';
import { ChatBubbleBottomCenterTextIcon, CheckCircleIcon, TrashIcon } from '../Icons';
import { artifactReviewService } from '../../services/review';
import { ReviewSyncBadge } from './ReviewSyncBadge';
import { useAriaAnnouncer } from '../../hooks/useAriaAnnouncer';
import type { ArtifactComment, ArtifactCommentAnchor, ArtifactCommentAuthor, ArtifactCommentStatus } from '../../services/review';

interface CommentThreadProps {
    artifactId: string;
    projectId: string;
    /** Author identity for new comments (current user). */
    author: ArtifactCommentAuthor;
    /** When provided, only comments anchored to this anchor are shown. */
    filterAnchor?: ArtifactCommentAnchor;
    /** Default anchor used when posting from this thread. */
    defaultAnchor?: ArtifactCommentAnchor;
    /** Initial status filter — defaults to "open". */
    initialStatusFilter?: ArtifactCommentStatus | 'all';
    /** Hide the "new comment" composer (useful in read-only contexts). */
    readOnly?: boolean;
}

function useComments(artifactId: string): ArtifactComment[] {
    return useSyncExternalStore(
        useCallback((listener: () => void) => artifactReviewService.subscribe(listener), []),
        useCallback(() => artifactReviewService.listComments(artifactId), [artifactId]),
        useCallback(() => artifactReviewService.listComments(artifactId), [artifactId]),
    );
}

function formatRelative(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return iso;
    const diffMs = Date.now() - then;
    const seconds = Math.round(diffMs / 1000);
    if (seconds < 60) return `hace ${Math.max(1, seconds)}s`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `hace ${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `hace ${hours}h`;
    const days = Math.round(hours / 24);
    if (days < 7) return `hace ${days}d`;
    return new Date(iso).toLocaleDateString();
}

function describeAnchor(anchor: ArtifactCommentAnchor): string {
    switch (anchor.kind) {
        case 'artifact':
            return 'Comentario general';
        case 'document-section':
            return anchor.sectionTitle ? `Sección: ${anchor.sectionTitle}` : 'Sección del documento';
        case 'diagram-node':
            return `Nodo ${anchor.nodeId}`;
        case 'diagram-edge':
            return `Conexión ${anchor.edgeId}`;
    }
}

function sameAnchor(a: ArtifactCommentAnchor, b: ArtifactCommentAnchor): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'document-section' && b.kind === 'document-section') return a.sectionId === b.sectionId;
    if (a.kind === 'diagram-node' && b.kind === 'diagram-node') return a.nodeId === b.nodeId;
    if (a.kind === 'diagram-edge' && b.kind === 'diagram-edge') return a.edgeId === b.edgeId;
    return true;
}

/**
 * Threaded comments for an artifact. Phase 1 stores comments in localStorage
 * via `artifactReviewService`; the API and data shape match a future
 * Firestore subcollection so swapping persistence is local.
 */
export const CommentThread: React.FC<CommentThreadProps> = ({
    artifactId,
    projectId,
    author,
    filterAnchor,
    defaultAnchor,
    initialStatusFilter = 'open',
    readOnly = false,
}) => {
    const all = useComments(artifactId);
    const { announce } = useAriaAnnouncer();
    const [statusFilter, setStatusFilter] = useState<ArtifactCommentStatus | 'all'>(initialStatusFilter);
    const [draft, setDraft] = useState('');
    const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);

    useEffect(() => { setError(null); }, [draft]);

    const filtered = useMemo(() => {
        return all.filter((c) => {
            if (filterAnchor && !sameAnchor(c.anchor, filterAnchor)) return false;
            if (statusFilter === 'all') return true;
            return c.status === statusFilter;
        });
    }, [all, filterAnchor, statusFilter]);

    const openCount = useMemo(() => all.filter((c) => c.status === 'open').length, [all]);

    const handleSubmit = () => {
        const body = draft.trim();
        if (body.length === 0) {
            setError('Escribe un comentario antes de enviar.');
            return;
        }
        artifactReviewService.addComment({
            artifactId,
            projectId,
            anchor: filterAnchor ?? defaultAnchor ?? { kind: 'artifact' },
            body,
            author,
        });
        setDraft('');
        announce('Comentario publicado.');
    };

    const handleReplySubmit = (commentId: string) => {
        const body = (replyDrafts[commentId] ?? '').trim();
        if (body.length === 0) return;
        artifactReviewService.replyToComment(commentId, body, author);
        setReplyDrafts((prev) => ({ ...prev, [commentId]: '' }));
        announce('Respuesta publicada.');
    };

    const handleResolve = (comment: ArtifactComment) => {
        const next = comment.status === 'open' ? 'resolved' : 'open';
        artifactReviewService.setCommentStatus(comment.id, next, author);
        announce(next === 'resolved' ? 'Comentario marcado como resuelto.' : 'Comentario reabierto.');
    };

    const handleDelete = (commentId: string) => {
        artifactReviewService.deleteComment(commentId);
    };

    return (
        <section className="flex flex-col gap-3" aria-label="Comentarios del artefacto">
            <header className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <ChatBubbleBottomCenterTextIcon className="h-4 w-4 text-gray-400" aria-hidden />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Comentarios</h3>
                    <Badge tone={openCount > 0 ? 'warning' : 'gray'} size="xs">
                        {openCount} abierto{openCount === 1 ? '' : 's'}
                    </Badge>
                    <ReviewSyncBadge projectId={projectId} artifactId={artifactId} />
                </div>
                <div className="flex items-center gap-1" role="group" aria-label="Filtrar comentarios">
                    {(['open', 'resolved', 'all'] as const).map((value) => (
                        <button
                            key={value}
                            type="button"
                            onClick={() => setStatusFilter(value)}
                            aria-pressed={statusFilter === value}
                            className={
                                'px-2 h-6 text-2xs font-medium rounded-md transition-colors ' +
                                (statusFilter === value
                                    ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-white'
                                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200')
                            }
                        >
                            {value === 'open' ? 'Abiertos' : value === 'resolved' ? 'Resueltos' : 'Todos'}
                        </button>
                    ))}
                </div>
            </header>

            {filtered.length === 0 ? (
                <EmptyState
                    icon={<ChatBubbleBottomCenterTextIcon className="h-5 w-5" />}
                    title="Sin comentarios todavía"
                    description="Inicia la conversación desde el composer para registrar decisiones, dudas o bloqueos."
                />
            ) : (
                <ol className="flex flex-col gap-3" aria-live="polite">
                    {filtered.map((comment) => (
                        <li
                            key={comment.id}
                            className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/60 p-3 shadow-sm"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                                        <span className="font-semibold text-gray-700 dark:text-gray-200">{comment.author.name}</span>
                                        <span aria-hidden>·</span>
                                        <time dateTime={comment.createdAt}>{formatRelative(comment.createdAt)}</time>
                                        <span aria-hidden>·</span>
                                        <span className="truncate">{describeAnchor(comment.anchor)}</span>
                                    </div>
                                    <p className="mt-1 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">
                                        {comment.body}
                                    </p>
                                    {comment.status === 'resolved' && comment.resolvedBy && comment.resolvedAt && (
                                        <p className="mt-1 text-2xs text-gray-400 dark:text-gray-500">
                                            Resuelto por {comment.resolvedBy.name}
                                            <span aria-hidden> · </span>
                                            <time dateTime={comment.resolvedAt}>{formatRelative(comment.resolvedAt)}</time>
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    <Badge tone={comment.status === 'resolved' ? 'success' : 'warning'} size="xs">
                                        {comment.status === 'resolved' ? 'Resuelto' : 'Abierto'}
                                    </Badge>
                                </div>
                            </div>

                            {comment.replies.length > 0 && (
                                <ol className="mt-3 pl-3 border-l border-gray-200 dark:border-gray-700 space-y-2">
                                    {comment.replies.map((reply) => (
                                        <li key={reply.id} className="text-sm">
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                                <span className="font-medium text-gray-700 dark:text-gray-200">{reply.author.name}</span>
                                                <span aria-hidden> · </span>
                                                <time dateTime={reply.createdAt}>{formatRelative(reply.createdAt)}</time>
                                            </div>
                                            <p className="mt-0.5 text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">{reply.body}</p>
                                        </li>
                                    ))}
                                </ol>
                            )}

                            {!readOnly && (
                                <div className="mt-3 flex flex-col gap-2">
                                    <label className="sr-only" htmlFor={`reply-${comment.id}`}>
                                        Responder al comentario de {comment.author.name}
                                    </label>
                                    <textarea
                                        id={`reply-${comment.id}`}
                                        value={replyDrafts[comment.id] ?? ''}
                                        onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                                        rows={2}
                                        placeholder="Responder…"
                                        className="w-full resize-y rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                    />
                                    <div className="flex items-center justify-end gap-2">
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            leftIcon={<TrashIcon className="h-3.5 w-3.5" />}
                                            onClick={() => handleDelete(comment.id)}
                                            aria-label="Eliminar comentario"
                                        >
                                            Eliminar
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant={comment.status === 'open' ? 'secondary' : 'ghost'}
                                            leftIcon={<CheckCircleIcon className="h-3.5 w-3.5" />}
                                            onClick={() => handleResolve(comment)}
                                        >
                                            {comment.status === 'open' ? 'Marcar resuelto' : 'Reabrir'}
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant="primary"
                                            disabled={(replyDrafts[comment.id] ?? '').trim().length === 0}
                                            onClick={() => handleReplySubmit(comment.id)}
                                        >
                                            Responder
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </li>
                    ))}
                </ol>
            )}

            {!readOnly && (
                <form
                    className="mt-1 flex flex-col gap-2"
                    onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
                    aria-label="Publicar nuevo comentario"
                >
                    <label className="sr-only" htmlFor={`new-comment-${artifactId}`}>Nuevo comentario</label>
                    <textarea
                        id={`new-comment-${artifactId}`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        placeholder="Escribe un comentario para el equipo…"
                        aria-invalid={error ? 'true' : undefined}
                        aria-describedby={error ? `new-comment-${artifactId}-error` : undefined}
                        className="w-full resize-y rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                    />
                    {error && (
                        <p id={`new-comment-${artifactId}-error`} role="alert" className="text-xs text-red-600 dark:text-red-300">
                            {error}
                        </p>
                    )}
                    <div className="flex items-center justify-end">
                        <Button type="submit" size="sm" variant="primary" disabled={draft.trim().length === 0}>
                            Publicar comentario
                        </Button>
                    </div>
                </form>
            )}
        </section>
    );
};

export default CommentThread;

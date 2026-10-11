import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import type { Translator } from '../../lib/i18n/spanishFallback';
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

function formatRelative(iso: string, t: Translator): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return iso;
    const diffMs = Date.now() - then;
    const seconds = Math.round(diffMs / 1000);
    if (seconds < 60) return t('uiDynamic.relativeSeconds', { count: String(Math.max(1, seconds)) });
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return t('uiDynamic.relativeMinutes', { count: String(minutes) });
    const hours = Math.round(minutes / 60);
    if (hours < 24) return t('uiDynamic.relativeHours', { count: String(hours) });
    const days = Math.round(hours / 24);
    if (days < 7) return t('uiDynamic.relativeDays', { count: String(days) });
    return new Date(iso).toLocaleDateString(document.documentElement.lang || 'es');
}

function describeAnchor(anchor: ArtifactCommentAnchor, t: Translator): string {
    switch (anchor.kind) {
        case 'artifact':
            return t('uiDynamic.generalComment');
        case 'document-section':
            return anchor.sectionTitle ? t('uiDynamic.documentSectionName', { name: anchor.sectionTitle }) : t('uiDynamic.documentSection');
        case 'diagram-node':
            return t('uiDynamic.diagramNodeName', { name: anchor.nodeId });
        case 'diagram-edge':
            return t('uiDynamic.diagramEdgeName', { name: anchor.edgeId });
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
  const t = useUiTranslation();
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
            setError(t("uiMessage.escribe-un-comentario-antes.7eb41d"));
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
        <section className="flex flex-col gap-3" aria-label={t("ui.comentarios-del-artefacto.c1a878")}>
            <header className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <ChatBubbleBottomCenterTextIcon className="h-4 w-4 text-gray-400" aria-hidden />
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t("ui.comentarios.054de5")}</h3>
                    <Badge tone={openCount > 0 ? 'warning' : 'gray'} size="xs">
                        {openCount} {t("ui.abierto.bcd2bf")}{openCount === 1 ? '' : 's'}
                    </Badge>
                    <ReviewSyncBadge projectId={projectId} artifactId={artifactId} />
                </div>
                <div className="flex items-center gap-1" role="group" aria-label={t("ui.filtrar-comentarios.8c1cf0")}>
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
                            {value === 'open' ? t("uiExpr.abiertos.7fe4b0") : value === 'resolved' ? t("uiExpr.resueltos.dd24ea") : t("ui.todos.a4114a")}
                        </button>
                    ))}
                </div>
            </header>

            {filtered.length === 0 ? (
                <EmptyState
                    icon={<ChatBubbleBottomCenterTextIcon className="h-5 w-5" />}
                    title={t("ui.sin-comentarios-todavia.36334e")}
                    description={t("Inicia la conversación desde el composer para registrar decisiones, dudas o bloqueos.")}
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
                                        <time dateTime={comment.createdAt}>{formatRelative(comment.createdAt, t)}</time>
                                        <span aria-hidden>·</span>
                                        <span className="truncate">{describeAnchor(comment.anchor, t)}</span>
                                    </div>
                                    <p className="mt-1 text-sm text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">
                                        {comment.body}
                                    </p>
                                    {comment.status === 'resolved' && comment.resolvedBy && comment.resolvedAt && (
                                        <p className="mt-1 text-2xs text-gray-400 dark:text-gray-500">
                                            {t("ui.resuelto-por.3f440b")} {comment.resolvedBy.name}
                                            <span aria-hidden> · </span>
                                            <time dateTime={comment.resolvedAt}>{formatRelative(comment.resolvedAt, t)}</time>
                                        </p>
                                    )}
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                    <Badge tone={comment.status === 'resolved' ? 'success' : 'warning'} size="xs">
                                        {comment.status === 'resolved' ? t("uiExpr.resuelto.92aa4b") : t("uiExpr.abierto.8708ae")}
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
                                                <time dateTime={reply.createdAt}>{formatRelative(reply.createdAt, t)}</time>
                                            </div>
                                            <p className="mt-0.5 text-gray-800 dark:text-gray-100 whitespace-pre-wrap break-words">{reply.body}</p>
                                        </li>
                                    ))}
                                </ol>
                            )}

                            {!readOnly && (
                                <div className="mt-3 flex flex-col gap-2">
                                    <label className="sr-only" htmlFor={`reply-${comment.id}`}>
                                        {t("ui.responder-al-comentario-de.ab4f88")} {comment.author.name}
                                    </label>
                                    <textarea
                                        id={`reply-${comment.id}`}
                                        value={replyDrafts[comment.id] ?? ''}
                                        onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [comment.id]: e.target.value }))}
                                        rows={2}
                                        placeholder={t("ui.responder.c9668c")}
                                        className="w-full resize-y rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                                    />
                                    <div className="flex items-center justify-end gap-2">
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            leftIcon={<TrashIcon className="h-3.5 w-3.5" />}
                                            onClick={() => handleDelete(comment.id)}
                                            aria-label={t("ui.eliminar-comentario.936360")}
                                        >
                                            {t("delete")}
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant={comment.status === 'open' ? 'secondary' : 'ghost'}
                                            leftIcon={<CheckCircleIcon className="h-3.5 w-3.5" />}
                                            onClick={() => handleResolve(comment)}
                                        >
                                            {comment.status === 'open' ? t("uiExpr.marcar-resuelto.dcca91") : t("uiExpr.reabrir.3a7b78")}
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant="primary"
                                            disabled={(replyDrafts[comment.id] ?? '').trim().length === 0}
                                            onClick={() => handleReplySubmit(comment.id)}
                                        >
                                            {t("ui.responder.20c9b5")}
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
                    aria-label={t("ui.publicar-nuevo-comentario.00c21e")}
                >
                    <label className="sr-only" htmlFor={`new-comment-${artifactId}`}>{t("ui.nuevo-comentario.94da9e")}</label>
                    <textarea
                        id={`new-comment-${artifactId}`}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={3}
                        placeholder={t("ui.escribe-un-comentario-para-e.97a7ab")}
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
                            {t("ui.publicar-comentario.bc0d10")}
                        </Button>
                    </div>
                </form>
            )}
        </section>
    );
};

export default CommentThread;

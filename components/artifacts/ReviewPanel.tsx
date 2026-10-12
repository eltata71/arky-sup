import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import React, { useCallback, useState, useSyncExternalStore } from 'react';
import { Button, Alert, Badge } from '../ui';
import { ReviewStatusBadge, reviewStatusLabel } from './ReviewStatusBadge';
import { ReviewSyncBadge } from './ReviewSyncBadge';
import { CheckCircleIcon, XCircleIcon, ExclamationTriangleIcon, ArrowPathIcon } from '../Icons';
import {
    artifactReviewService,
    InvalidReviewTransitionError,
    canTransitionReviewStatus,
    describeInvalidTransition,
} from '../../services/review';
import { useAriaAnnouncer } from '../../hooks/useAriaAnnouncer';
import type { ArtifactCommentAuthor, ArtifactReviewDecision, ArtifactReviewStatus } from '../../services/review';

interface ReviewPanelProps {
    artifactId: string;
    projectId: string;
    author: ArtifactCommentAuthor;
    /** Current persisted status on the artifact (fallback when no decision exists). */
    currentStatus?: ArtifactReviewStatus;
    /** Persist the new status back onto the artifact. */
    onStatusChange?: (status: ArtifactReviewStatus) => void;
}

function useDecisions(artifactId: string): ArtifactReviewDecision[] {
    return useSyncExternalStore(
        useCallback((listener: () => void) => artifactReviewService.subscribe(listener), []),
        useCallback(() => artifactReviewService.listDecisions(artifactId), [artifactId]),
        useCallback(() => artifactReviewService.listDecisions(artifactId), [artifactId]),
    );
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString();
}

const TRANSITIONS: Array<{
    status: ArtifactReviewStatus;
    label: string;
    variant: 'primary' | 'success' | 'danger' | 'secondary';
    icon: React.ReactNode;
    needsRationale?: boolean;
}> = [
    { status: 'pending-review', label: 'Enviar a revisión', variant: 'primary', icon: <ArrowPathIcon className="h-4 w-4" /> },
    { status: 'approved', label: 'Aprobar', variant: 'success', icon: <CheckCircleIcon className="h-4 w-4" /> },
    { status: 'changes-requested', label: 'Solicitar cambios', variant: 'secondary', icon: <ExclamationTriangleIcon className="h-4 w-4" />, needsRationale: true },
    { status: 'rejected', label: 'Rechazar', variant: 'danger', icon: <XCircleIcon className="h-4 w-4" />, needsRationale: true },
];

/**
 * Review/approval workflow for a single artifact. Records each status
 * transition as an immutable decision in `artifactReviewService` (ADR-lite),
 * so the artifact carries a transparent audit trail.
 */
export const ReviewPanel: React.FC<ReviewPanelProps> = ({
    artifactId,
    projectId,
    author,
    currentStatus,
    onStatusChange,
}) => {
  const translateConfig = useUiTranslation();
  const t = useUiTranslation();
    const decisions = useDecisions(artifactId);
    const { announce } = useAriaAnnouncer();
    const latest = decisions.length > 0 ? decisions[decisions.length - 1].status : currentStatus ?? 'draft';
    const [rationale, setRationale] = useState('');
    const [pendingStatus, setPendingStatus] = useState<ArtifactReviewStatus | null>(null);
    const [transitionError, setTransitionError] = useState<string | null>(null);

    const applyTransition = (status: ArtifactReviewStatus, needsRationale?: boolean) => {
        if (needsRationale && rationale.trim().length === 0) {
            setPendingStatus(status);
            return;
        }
        try {
            artifactReviewService.recordDecision({
                artifactId,
                projectId,
                status,
                rationale: rationale.trim() || undefined,
                author,
            });
        } catch (error) {
            // The service is the authority on what is legal; the buttons below
            // already hide illegal moves, so this only fires when the log moved
            // under us (another tab, a late sync).
            if (error instanceof InvalidReviewTransitionError) {
                setTransitionError(describeInvalidTransition(error.from, error.to));
                announce(describeInvalidTransition(error.from, error.to), 'assertive');
                return;
            }
            throw error;
        }
        setTransitionError(null);
        onStatusChange?.(status);
        setRationale('');
        setPendingStatus(null);
        announce(t("uiDynamicGenerated.estado-de-revision-actualiza.4ecaec", { p0: String(reviewStatusLabel(status)) }), 'assertive');
    };

    return (
        <section className="flex flex-col gap-4" aria-label={t("ui.revision-del-artefacto.4ce657")}>
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{t("ui.estado-de-revision.7a7b1f")}</h3>
                <div className="flex items-center gap-2">
                    <ReviewSyncBadge projectId={projectId} artifactId={artifactId} />
                    <ReviewStatusBadge status={latest} />
                </div>
            </div>

            {latest === 'approved' && (
                <Alert tone="success" variant="soft">{t("ui.este-artefacto-esta-aprobado.59f881")}</Alert>
            )}
            {latest === 'changes-requested' && (
                <Alert tone="warning" variant="soft">{t("ui.un-revisor-solicito-cambios.130a77")}</Alert>
            )}
            {latest === 'rejected' && (
                <Alert tone="danger" variant="soft">{t("ui.este-artefacto-fue-rechazado.a428d7")}</Alert>
            )}

            {transitionError && (
                <Alert tone="danger" variant="soft" onDismiss={() => setTransitionError(null)}>
                    {transitionError}
                </Alert>
            )}

            <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t("ui.acciones-de-revision.0b9f47")}</p>
                <div className="flex flex-wrap gap-2">
                    {TRANSITIONS.filter((t) => t.status !== latest && canTransitionReviewStatus(latest, t.status)).map((t) => (
                        <Button
                            key={t.status}
                            size="sm"
                            variant={t.variant}
                            leftIcon={t.icon}
                            onClick={() => applyTransition(t.status, t.needsRationale)}
                        >
                            {translateConfig(t.label)}
                        </Button>
                    ))}
                </div>
            </div>

            <div>
                <label htmlFor={`review-rationale-${artifactId}`} className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    {t("ui.justificacion.0aabb1")} {pendingStatus ? t("uiExpr.requerida-para-esta-accion.668f81") : t("ui.opcional.813486")}
                </label>
                <textarea
                    id={`review-rationale-${artifactId}`}
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    rows={2}
                    placeholder={t("ui.explica-la-decision-para-la.9c87e8")}
                    aria-invalid={pendingStatus ? 'true' : undefined}
                    className="mt-1 w-full resize-y rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
                {pendingStatus && (
                    <div className="mt-2 flex items-center gap-2">
                        <p role="alert" className="text-xs text-amber-600 dark:text-amber-300 flex-1">
                            {t("ui.escribe-una-justificacion-y.b5108c")}
                        </p>
                        <Button
                            size="xs"
                            variant="primary"
                            disabled={rationale.trim().length === 0}
                            onClick={() => applyTransition(pendingStatus)}
                        >
                            {t("ui.confirmar.81b4b6")}
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setPendingStatus(null)}>{t("ui.cancelar.c111e0")}</Button>
                    </div>
                )}
            </div>

            <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    {t("ui.bitacora-de-decisiones.162114")}
                </p>
                {decisions.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                        {t("ui.sin-decisiones-registradas-l.a3b875")}
                    </p>
                ) : (
                    <ol className="space-y-2">
                        {[...decisions].reverse().map((d) => (
                            <li key={d.id} className="rounded-md border border-gray-200 dark:border-gray-800 p-2.5 text-xs">
                                <div className="flex items-center justify-between gap-2">
                                    <ReviewStatusBadge status={d.status} />
                                    <time dateTime={d.decidedAt} className="text-gray-400 dark:text-gray-500">
                                        {formatDate(d.decidedAt)}
                                    </time>
                                </div>
                                <p className="mt-1 text-gray-500 dark:text-gray-400">
                                    <span className="font-medium text-gray-700 dark:text-gray-200">{d.author.name}</span>
                                    {d.rationale ? ` — ${d.rationale}` : ''}
                                </p>
                            </li>
                        ))}
                    </ol>
                )}
            </div>

            <p className="text-2xs text-gray-400 dark:text-gray-500 flex items-center gap-1.5">
                <Badge tone="gray" size="xs">{t("ui.fase-2.7ec3d1")}</Badge>
                {t("ui.revision-local-first-con-sin.62ebed")}
            </p>
        </section>
    );
};

export default ReviewPanel;

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
        announce(`Estado de revisión actualizado: ${reviewStatusLabel(status)}.`, 'assertive');
    };

    return (
        <section className="flex flex-col gap-4" aria-label="Revisión del artefacto">
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Estado de revisión</h3>
                <div className="flex items-center gap-2">
                    <ReviewSyncBadge projectId={projectId} artifactId={artifactId} />
                    <ReviewStatusBadge status={latest} />
                </div>
            </div>

            {latest === 'approved' && (
                <Alert tone="success" variant="soft">Este artefacto está aprobado y listo para usarse.</Alert>
            )}
            {latest === 'changes-requested' && (
                <Alert tone="warning" variant="soft">Un revisor solicitó cambios. Resuélvelos y vuelve a enviarlo.</Alert>
            )}
            {latest === 'rejected' && (
                <Alert tone="danger" variant="soft">Este artefacto fue rechazado. Revisa la bitácora para conocer el motivo.</Alert>
            )}

            {transitionError && (
                <Alert tone="danger" variant="soft" onDismiss={() => setTransitionError(null)}>
                    {transitionError}
                </Alert>
            )}

            <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Acciones de revisión</p>
                <div className="flex flex-wrap gap-2">
                    {TRANSITIONS.filter((t) => t.status !== latest && canTransitionReviewStatus(latest, t.status)).map((t) => (
                        <Button
                            key={t.status}
                            size="sm"
                            variant={t.variant}
                            leftIcon={t.icon}
                            onClick={() => applyTransition(t.status, t.needsRationale)}
                        >
                            {t.label}
                        </Button>
                    ))}
                </div>
            </div>

            <div>
                <label htmlFor={`review-rationale-${artifactId}`} className="text-xs font-medium text-gray-500 dark:text-gray-400">
                    Justificación {pendingStatus ? '(requerida para esta acción)' : '(opcional)'}
                </label>
                <textarea
                    id={`review-rationale-${artifactId}`}
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    rows={2}
                    placeholder="Explica la decisión para la bitácora…"
                    aria-invalid={pendingStatus ? 'true' : undefined}
                    className="mt-1 w-full resize-y rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-2.5 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                />
                {pendingStatus && (
                    <div className="mt-2 flex items-center gap-2">
                        <p role="alert" className="text-xs text-amber-600 dark:text-amber-300 flex-1">
                            Escribe una justificación y confirma la acción.
                        </p>
                        <Button
                            size="xs"
                            variant="primary"
                            disabled={rationale.trim().length === 0}
                            onClick={() => applyTransition(pendingStatus)}
                        >
                            Confirmar
                        </Button>
                        <Button size="xs" variant="ghost" onClick={() => setPendingStatus(null)}>Cancelar</Button>
                    </div>
                )}
            </div>

            <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                    Bitácora de decisiones
                </p>
                {decisions.length === 0 ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 italic">
                        Sin decisiones registradas. Las transiciones de estado se guardan aquí como historial.
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
                <Badge tone="gray" size="xs">Fase 2</Badge>
                Revisión local-first con sincronización a Firestore cuando hay sesión y conexión.
            </p>
        </section>
    );
};

export default ReviewPanel;

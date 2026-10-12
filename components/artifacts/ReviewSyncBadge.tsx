import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
/**
 * ReviewSyncBadge — shows the synchronisation state of an artifact's
 * collaborative review data (comments + decisions).
 *
 * It also starts remote synchronisation for the artifact on mount via
 * `artifactReviewService.ensureSynced`, so simply rendering the badge wires
 * the artifact into the local↔remote sync loop.
 */

import React, { useCallback, useEffect, useSyncExternalStore } from 'react';
import { Badge } from '../ui';
import { artifactReviewService } from '../../services/review';
import type { ReviewSyncState, ReviewSyncStatus } from '../../services/review';

interface ReviewSyncBadgeProps {
    projectId: string;
    artifactId: string;
}

const STATUS_META: Record<
    ReviewSyncStatus,
    { label: string; tone: 'gray' | 'primary' | 'success' | 'warning' | 'danger'; title: string }
> = {
    'local-only': {
        label: 'Local',
        tone: 'gray',
        title: 'La revisión se guarda solo en este navegador (Supabase no está configurado).',
    },
    syncing: {
        label: 'Sincronizando…',
        tone: 'primary',
        title: 'Guardando los cambios de revisión en Supabase.',
    },
    synced: {
        label: 'Sincronizado',
        tone: 'success',
        title: 'La revisión está sincronizada con Supabase.',
    },
    'sync-error': {
        label: 'Error de sync',
        tone: 'danger',
        title: 'No se pudo sincronizar con Supabase. Los datos están a salvo localmente.',
    },
    offline: {
        label: 'Sin conexión',
        tone: 'warning',
        title: 'Sin conexión: los cambios se guardan localmente y se sincronizarán al reconectar.',
    },
};

export const ReviewSyncBadge: React.FC<ReviewSyncBadgeProps> = ({ projectId, artifactId }) => {
  const t = useUiTranslation();
    useEffect(() => {
        artifactReviewService.ensureSynced(projectId, artifactId);
    }, [projectId, artifactId]);

    const syncState: ReviewSyncState = useSyncExternalStore(
        useCallback((listener: () => void) => artifactReviewService.subscribe(listener), []),
        useCallback(() => artifactReviewService.getSyncState(artifactId), [artifactId]),
        useCallback(() => artifactReviewService.getSyncState(artifactId), [artifactId]),
    );

    const meta = STATUS_META[syncState.status];
    const label =
        syncState.pendingCount > 0 && syncState.status !== 'synced'
            ? `${t(meta.label)} (${syncState.pendingCount})`
            : t(meta.label);

    return (
        <span role="status" aria-label={t("uiTemplate.estado-de-sincronizacion-p0.13bd0a", { p0: t(meta.title) })}>
            <Badge tone={meta.tone} size="xs" dot>
                {label}
            </Badge>
        </span>
    );
};

export default ReviewSyncBadge;

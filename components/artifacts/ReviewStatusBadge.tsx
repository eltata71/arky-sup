import React from 'react';
import { Badge, BadgeTone } from '../ui';
import type { ArtifactReviewStatus } from '../../services/review';

interface ReviewStatusBadgeProps {
    status?: ArtifactReviewStatus;
    /** Render a compact dot-only version (saves horizontal space). */
    compact?: boolean;
}

const STATUS_META: Record<ArtifactReviewStatus, { tone: BadgeTone; label: string; description: string }> = {
    draft: {
        tone: 'gray',
        label: 'Borrador',
        description: 'Sin enviar a revisión',
    },
    'pending-review': {
        tone: 'info',
        label: 'En revisión',
        description: 'Esperando aprobación',
    },
    'changes-requested': {
        tone: 'warning',
        label: 'Requiere cambios',
        description: 'Un revisor pidió ajustes',
    },
    approved: {
        tone: 'success',
        label: 'Aprobado',
        description: 'Listo para usar',
    },
    rejected: {
        tone: 'danger',
        label: 'Rechazado',
        description: 'No se aprobó',
    },
};

/**
 * Compact badge for the artifact review/approval status. Wraps the generic
 * Badge primitive with consistent tone + label mapping so the status is
 * presented the same way everywhere.
 */
export const ReviewStatusBadge: React.FC<ReviewStatusBadgeProps> = ({ status = 'draft', compact = false }) => {
    const meta = STATUS_META[status];
    return (
        <Badge tone={meta.tone} dot size="sm" title={meta.description} aria-label={`Estado de revisión: ${meta.label}`}>
            {compact ? null : meta.label}
        </Badge>
    );
};

export const reviewStatusLabel = (status?: ArtifactReviewStatus): string =>
    (status && STATUS_META[status]?.label) ?? STATUS_META.draft.label;

export default ReviewStatusBadge;

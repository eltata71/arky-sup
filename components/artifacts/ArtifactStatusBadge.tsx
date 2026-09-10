import React from 'react';
import { Badge, BadgeTone, Tooltip } from '../ui';
import { Artifact } from '../../types';
import {
    CheckCircleIcon,
    ExclamationTriangleIcon,
    XCircleIcon,
    SparklesIcon,
    ArrowPathIcon,
} from '../Icons';

export type ArtifactStatusKind =
    | 'generated'           // recién generado, sin validar todavía
    | 'refined'
    | 'refined-warnings'
    | 'edited'              // editado por el usuario
    | 'validated'           // validado y limpio
    | 'warnings'            // tiene advertencias
    | 'errors'              // tiene errores que deben resolverse
    | 'exportable'
    | 'not-exportable'
    | 'persisted-remote'
    | 'persisted-local'
    | 'pending-sync'
    | 'fallback-local'
    | 'in-progress';

interface ArtifactStatusBadgeProps {
    /** Optional artifact — when present, status is derived automatically. */
    artifact?: Artifact;
    /** Explicit status override (skips derivation). */
    status?: ArtifactStatusKind;
    /** Force compact layout (icon + tone, no label). */
    compact?: boolean;
    /** Optional click handler — turns the badge into a button. */
    onClick?: () => void;
    /** Extra Tailwind classes for the wrapper. */
    className?: string;
}

const STATUS_META: Record<
    ArtifactStatusKind,
    { tone: BadgeTone; label: string; description: string; Icon?: React.FC<{ className?: string }> }
> = {
    generated: { tone: 'primary', label: 'Generado', description: 'Recién creado por el agente', Icon: SparklesIcon },
    refined: { tone: 'success', label: 'Refinado', description: 'Quality gate semántico aplicado antes de persistir', Icon: SparklesIcon },
    'refined-warnings': { tone: 'warning', label: 'Refinado con advertencias', description: 'Refinado, pero conserva advertencias observables', Icon: ExclamationTriangleIcon },
    edited: { tone: 'info', label: 'Editado', description: 'Modificado manualmente' },
    validated: { tone: 'success', label: 'Validado', description: 'Sin advertencias', Icon: CheckCircleIcon },
    warnings: { tone: 'warning', label: 'Con advertencias', description: 'Revisar advertencias antes de aprobar', Icon: ExclamationTriangleIcon },
    errors: { tone: 'danger', label: 'Con errores', description: 'Requiere corrección', Icon: XCircleIcon },
    exportable: { tone: 'success', label: 'Exportable', description: 'Listo para exportar' },
    'not-exportable': { tone: 'gray', label: 'No exportable', description: 'Faltan pasos para exportar' },
    'persisted-remote': { tone: 'success', label: 'Sincronizado', description: 'Guardado en la nube' },
    'persisted-local': { tone: 'info', label: 'Local', description: 'Guardado en este dispositivo' },
    'pending-sync': { tone: 'warning', label: 'Pendiente de sincronizar', description: 'Aún no llegó a la nube', Icon: ArrowPathIcon },
    'fallback-local': { tone: 'warning', label: 'Fallback local', description: 'Modo degradado; sincronizará al recuperar conexión' },
    'in-progress': { tone: 'ai', label: 'Generando…', description: 'El agente está trabajando', Icon: ArrowPathIcon },
};

/**
 * Derive a primary status kind from artifact trace + persistence metadata.
 * Returns the most relevant single state — callers that want to show
 * multiple states (e.g. warnings + remote-persisted) should render two badges.
 */
export function deriveArtifactStatus(artifact?: Artifact): ArtifactStatusKind {
    if (!artifact) return 'in-progress';
    const trace = artifact.generationTrace;
    if (trace?.status === 'failed') return 'errors';
    if (trace?.status === 'fallback' || artifact.lastDiagramError?.reason === 'skeleton-fallback') return 'fallback-local';
    if (artifact.lastDiagramError) return 'errors';
    if (trace?.quality?.refinementAccepted && ((trace.quality.refinementWarnings ?? 0) > 0 || trace?.warnings?.some((warning) => warning.toLowerCase().includes('refinement')))) return 'refined-warnings';
    if (trace?.status === 'warning' || (trace?.warnings && trace.warnings.length > 0)) return 'warnings';
    if (trace?.quality?.refinementAccepted) return 'refined';
    const remote = trace?.persistence?.remote;
    if (remote === 'success') return 'persisted-remote';
    if (remote === 'pending') return 'pending-sync';
    if (remote === 'failed' || remote === 'conflict') return 'fallback-local';
    if (trace?.persistence?.local === 'success') return 'persisted-local';
    if (trace?.status === 'clean') return 'validated';
    return 'generated';
}

/**
 * Single, consistent badge that shows the most relevant status of an
 * artifact — generated / validated / warnings / errors / persisted / pending
 * sync / fallback / in-progress. Replaces ad-hoc badges scattered through
 * panels with one component the user learns to read once.
 */
export const ArtifactStatusBadge: React.FC<ArtifactStatusBadgeProps> = ({
    artifact,
    status,
    compact = false,
    onClick,
    className,
}) => {
    const effective = status ?? deriveArtifactStatus(artifact);
    const meta = STATUS_META[effective];
    const Icon = meta.Icon;
    const badge = (
        <Badge
            tone={meta.tone}
            dot={!Icon}
            size="sm"
            className={className}
            aria-label={`Estado: ${meta.label}. ${meta.description}`}
        >
            {Icon && <Icon className="h-3 w-3" aria-hidden />}
            {!compact && <span>{meta.label}</span>}
        </Badge>
    );

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className="inline-flex focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-md"
                aria-label={`${meta.label}. Ver detalles.`}
            >
                <Tooltip label={meta.description}>{badge}</Tooltip>
            </button>
        );
    }

    return <Tooltip label={meta.description}>{badge}</Tooltip>;
};

export default ArtifactStatusBadge;

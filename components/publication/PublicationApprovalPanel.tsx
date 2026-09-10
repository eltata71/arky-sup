import React, { useState } from 'react';
import { Badge, Button } from '../ui';
import {
  publicationStatusLabel,
  type PublicationPackage,
  type PublicationProfile,
  type PublicationReadinessReport,
} from '../../services/publicationPipeline';
import { statusTone } from './publicationUi';

interface PublicationApprovalPanelProps {
  pkg: PublicationPackage;
  profile: PublicationProfile;
  readiness: PublicationReadinessReport;
  busy?: boolean;
  onSubmitForReview: (comment: string) => void;
  onRequestChanges: (reason: string) => void;
  onApprove: (comment: string) => void;
  onPublish: (override: boolean, overrideReason: string) => void;
  onArchive: (reason: string) => void;
  onCreateVersion: () => void;
}

/**
 * Governance panel: drives the draft → review → approved → published workflow.
 * Buttons are enabled only for legal transitions, and publication enforces the
 * hard rules (no publishing with critical blockers, override is audited).
 */
export const PublicationApprovalPanel: React.FC<PublicationApprovalPanelProps> = ({
  pkg, profile, readiness, busy,
  onSubmitForReview, onRequestChanges, onApprove, onPublish, onArchive, onCreateVersion,
}) => {
  const [comment, setComment] = useState('');
  const [override, setOverride] = useState(false);

  const hasBlockers = readiness.blockers.length > 0 || readiness.status === 'blocked';
  const hasWarnings = readiness.warnings.length > 0 || readiness.status === 'warning';
  const needsApproval = profile.approvalRequired;
  const isApproved = pkg.status === 'approved';

  const canSubmit = (pkg.status === 'draft' || pkg.status === 'changes-requested' || pkg.status === 'blocked')
    && pkg.artifactRefs.length > 0;
  const canRequestChanges = pkg.status === 'ready-for-review';
  const canApprove = pkg.status === 'ready-for-review' && !hasBlockers;
  const canPublish = !hasBlockers && readiness.canPublish && pkg.status !== 'archived'
    && (!needsApproval || isApproved)
    && (!hasWarnings || override);
  const canArchive = pkg.status !== 'archived';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Estado del paquete
        </span>
        <Badge tone={statusTone(pkg.status)} size="sm">{publicationStatusLabel(pkg.status)}</Badge>
        <Badge tone="gray" size="sm" outline>Versión {pkg.version}</Badge>
        {pkg.freshness !== 'current' && (
          <Badge tone="warning" size="sm">{pkg.freshness === 'stale' ? 'Desactualizado' : 'Obsoleto'}</Badge>
        )}
      </div>

      <label className="block">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Comentario / motivo (opcional para enviar y aprobar; obligatorio para solicitar cambios)
        </span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-white/15 dark:bg-white/[0.04] dark:text-white"
          placeholder="Describe el motivo de la transición…"
          aria-label="Describe el motivo de la transición…"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={!canSubmit || busy}
          onClick={() => onSubmitForReview(comment)}
          aria-label="Enviar el paquete a revisión">
          Enviar a revisión
        </Button>
        <Button variant="secondary" size="sm" disabled={!canRequestChanges || busy || !comment.trim()}
          onClick={() => onRequestChanges(comment)}
          aria-label="Solicitar cambios en el paquete">
          Solicitar cambios
        </Button>
        <Button variant="primary" size="sm" disabled={!canApprove || busy}
          onClick={() => onApprove(comment)}
          aria-label="Aprobar el paquete">
          Aprobar
        </Button>
        <Button variant="secondary" size="sm" disabled={!canArchive || busy}
          onClick={() => onArchive(comment)}
          aria-label="Archivar el paquete">
          Archivar
        </Button>
        <Button variant="ghost" size="sm" disabled={busy}
          onClick={onCreateVersion}
          aria-label="Crear una nueva versión del paquete">
          Nueva versión
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
        <p className="text-sm font-bold text-slate-900 dark:text-white">Publicación</p>
        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
          {hasBlockers
            ? 'No se puede publicar: hay bloqueadores críticos sin resolver.'
            : needsApproval && !isApproved
              ? 'Este perfil requiere aprobación formal antes de publicar.'
              : hasWarnings
                ? 'El paquete tiene advertencias no críticas. Confirma con override para publicar.'
                : 'El paquete está listo para publicarse.'}
        </p>
        {hasWarnings && !hasBlockers && (
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500"
            />
            Publicar aceptando las advertencias (override auditado)
          </label>
        )}
        <div className="mt-2">
          <Button variant="primary" size="sm" disabled={!canPublish || busy}
            onClick={() => onPublish(override, comment)}
            aria-label="Publicar el paquete">
            Publicar paquete
          </Button>
        </div>
      </div>

      <section aria-label="Historial de auditoría">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
          Historial de auditoría ({pkg.auditTrail.length})
        </h3>
        <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
          {[...pkg.auditTrail].reverse().slice(0, 20).map((entry) => (
            <li key={entry.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 dark:bg-white/[0.03]">
              <span className="font-mono text-slate-400 dark:text-slate-500">
                {entry.timestamp.slice(0, 16).replace('T', ' ')}
              </span>{' '}
              <span className="font-semibold text-slate-700 dark:text-slate-200">{entry.action}</span>{' '}
              <span className="text-slate-500 dark:text-slate-400">· {entry.actor.name}</span>
              <p className="text-slate-600 dark:text-slate-300">{entry.details}</p>
            </li>
          ))}
          {pkg.auditTrail.length === 0 && (
            <li className="text-slate-500 dark:text-slate-400">Sin entradas de auditoría.</li>
          )}
        </ul>
      </section>
    </div>
  );
};

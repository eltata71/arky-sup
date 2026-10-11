import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
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
  const t = useUiTranslation();
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
          {t("ui.estado-del-paquete.6b80bb")}
        </span>
        <Badge tone={statusTone(pkg.status)} size="sm">{publicationStatusLabel(pkg.status)}</Badge>
        <Badge tone="gray" size="sm" outline>{t("projectHub.version")} {pkg.version}</Badge>
        {pkg.freshness !== 'current' && (
          <Badge tone="warning" size="sm">{pkg.freshness === 'stale' ? t("uiExpr.desactualizado.bda113") : t("uiExpr.obsoleto.71364b")}</Badge>
        )}
      </div>

      <label className="block">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {t("ui.comentario-motivo-opcional-p.51cc0b")}
        </span>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-white/15 dark:bg-white/[0.04] dark:text-white"
          placeholder={t("ui.describe-el-motivo-de-la-tra.00b3dc")}
          aria-label={t("ui.describe-el-motivo-de-la-tra.00b3dc")}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={!canSubmit || busy}
          onClick={() => onSubmitForReview(comment)}
          aria-label={t("ui.enviar-el-paquete-a-revision.80f4b5")}>
          {t("ui.enviar-a-revision.bcef7a")}
        </Button>
        <Button variant="secondary" size="sm" disabled={!canRequestChanges || busy || !comment.trim()}
          onClick={() => onRequestChanges(comment)}
          aria-label={t("ui.solicitar-cambios-en-el-paqu.28eb56")}>
          {t("ui.solicitar-cambios.353d2a")}
        </Button>
        <Button variant="primary" size="sm" disabled={!canApprove || busy}
          onClick={() => onApprove(comment)}
          aria-label={t("ui.aprobar-el-paquete.c9583d")}>
          {t("ui.aprobar.c2505a")}
        </Button>
        <Button variant="secondary" size="sm" disabled={!canArchive || busy}
          onClick={() => onArchive(comment)}
          aria-label={t("ui.archivar-el-paquete.361c9c")}>
          {t("ui.archivar.2a8569")}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy}
          onClick={onCreateVersion}
          aria-label={t("ui.crear-una-nueva-version-del.77c038")}>
          {t("ui.nueva-version.cedd81")}
        </Button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
        <p className="text-sm font-bold text-slate-900 dark:text-white">{t("projectHub.publication")}</p>
        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
          {hasBlockers
            ? t("uiExpr.no-se-puede-publicar-hay-blo.ac36a1")
            : needsApproval && !isApproved
              ? t("uiExpr.este-perfil-requiere-aprobac.840bca")
              : hasWarnings
                ? t("uiExpr.el-paquete-tiene-advertencia.013095")
                : t("uiExpr.el-paquete-esta-listo-para-p.4487b6")}
        </p>
        {hasWarnings && !hasBlockers && (
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-primary-600 focus-visible:ring-2 focus-visible:ring-primary-500"
            />
            {t("ui.publicar-aceptando-las-adver.f6c4a5")}
          </label>
        )}
        <div className="mt-2">
          <Button variant="primary" size="sm" disabled={!canPublish || busy}
            onClick={() => onPublish(override, comment)}
            aria-label={t("ui.publicar-el-paquete.23c949")}>
            {t("ui.publicar-paquete.582ff9")}
          </Button>
        </div>
      </div>

      <section aria-label={t("ui.historial-de-auditoria.e7082d")}>
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">
          {t("ui.historial-de-auditoria.dbd186")}{pkg.auditTrail.length})
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
            <li className="text-slate-500 dark:text-slate-400">{t("ui.sin-entradas-de-auditoria.78f2e2")}</li>
          )}
        </ul>
      </section>
    </div>
  );
};

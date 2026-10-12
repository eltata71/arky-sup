import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import React from 'react';
import { Modal } from '../Modal';
import { Badge } from '../ui';
import type { PublicationPreflightReport } from '../../services/publicationPipeline';
import { scoreTone, severityLabel, severityTone, verdictLabel, verdictTone } from './publicationUi';

interface PublicationPreflightModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: PublicationPreflightReport | null;
}

/**
 * Detailed preflight modal: every finding plus the per-artifact breakdown of
 * the 27-check publication preflight.
 */
export const PublicationPreflightModal: React.FC<PublicationPreflightModalProps> = ({
  isOpen, onClose, report,
}) =>{ const t = useUiTranslation(); return  (
  <Modal
    isOpen={isOpen}
    onClose={onClose}
    title={t("ui.preflight-de-publicacion.2049cd")}
    description={t("Resultado detallado de las 27 verificaciones de preparación para publicación.")}
  >
    {!report ? (
      <p className="text-sm text-slate-500 dark:text-slate-400">{t("ui.aun-no-se-ha-ejecutado-el-pr.23838c")}</p>
    ) : (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={verdictTone(report.verdict)} size="sm">{verdictLabel(report.verdict)}</Badge>
          <Badge tone={scoreTone(report.score)} size="sm" outline>{report.score}/100</Badge>
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {report.findings.length} {t("ui.hallazgo-s.aa57d6")} {report.requiredActions.length} {t("ui.accion-es-requerida-s.d53375")}
          </span>
        </div>

        <section aria-label={t("ui.hallazgos-del-preflight.7d6b36")}>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("ui.hallazgos.199824")}</h3>
          {report.findings.length === 0 ? (
            <p className="mt-1 text-sm text-green-700 dark:text-green-300">{t("ui.sin-hallazgos-el-paquete-sup.f95dee")}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {report.findings.map((f) => (
                <li key={f.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={severityTone(f.severity)} size="xs">{severityLabel(f.severity)}</Badge>
                    {f.blocking && <Badge tone="danger" size="xs" outline>{t("ui.bloqueante.afb2a3")}</Badge>}
                    <code className="text-[11px] text-slate-400 dark:text-slate-500">{f.code}</code>
                    {f.artifactName && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">· {f.artifactName}</span>
                    )}
                  </div>
                  <p className="mt-1 font-semibold text-slate-900 dark:text-white">{f.message}</p>
                  <p className="mt-0.5 text-slate-600 dark:text-slate-300">{f.recommendation}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {report.artifactResults.length > 0 && (
          <section aria-label={t("ui.resultado-por-artefacto.94ccaf")}>
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t("ui.por-artefacto.fbb89c")}</h3>
            <ul className="mt-2 space-y-1.5">
              {report.artifactResults.map((r) => (
                <li key={r.artifactId} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/[0.03]">
                  <span className="truncate text-slate-800 dark:text-slate-200">{r.artifactName}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={verdictTone(r.verdict)} size="xs">{verdictLabel(r.verdict)}</Badge>
                    <Badge tone={scoreTone(r.score)} size="xs" outline>{r.score}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    )}
  </Modal>
); };

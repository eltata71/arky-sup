import { useUiTranslation } from '../../lib/i18n/UiTranslationContext';
import React from 'react';
import { Badge } from '../ui';
import type { PublicationAccessibilityReport } from '../../services/publicationPipeline';
import { scoreTone, severityLabel, severityTone, verdictLabel, verdictTone } from './publicationUi';

interface PublicationAccessibilityPanelProps {
  report: PublicationAccessibilityReport;
}

/**
 * Accessibility panel: score, level, blocking verdict and per-issue
 * recommendations derived from the content-level accessibility checks.
 */
export const PublicationAccessibilityPanel: React.FC<PublicationAccessibilityPanelProps> = ({ report }) =>{ const t = useUiTranslation(); return  (
  <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={verdictTone(report.verdict)} size="sm">{verdictLabel(report.verdict)}</Badge>
      <Badge tone={scoreTone(report.score)} size="sm" outline>{report.score}/100</Badge>
      <Badge tone="gray" size="sm" outline>{t("ui.nivel.b70636")} {report.level}</Badge>
      {report.blocked && <Badge tone="danger" size="sm">{t("ui.no-cumple-el-minimo.1b87ff")}</Badge>}
    </div>

    {report.blocked && (
      <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
        {t("ui.el-paquete-no-alcanza-el-niv.c6ddcb")}
      </p>
    )}

    <section aria-label={t("ui.hallazgos-de-accesibilidad.cf1bd8")}>
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
        {t("ui.hallazgos.97688d")}{report.issues.length})
      </h3>
      {report.issues.length === 0 ? (
        <p className="mt-1 text-sm text-green-700 dark:text-green-300">
          {t("ui.no-se-detectaron-problemas-d.a0cd7c")}
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {report.issues.map((issue) => (
            <li key={issue.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={severityTone(issue.severity)} size="xs">{severityLabel(issue.severity)}</Badge>
                <code className="text-[11px] text-slate-400 dark:text-slate-500">{issue.code}</code>
                {issue.artifactName && (
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">· {issue.artifactName}</span>
                )}
              </div>
              <p className="mt-1 font-semibold text-slate-900 dark:text-white">{issue.message}</p>
              <p className="mt-0.5 text-slate-600 dark:text-slate-300">{issue.recommendation}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  </div>
); };

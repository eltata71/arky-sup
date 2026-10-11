import { useUiTranslation } from '../../../lib/i18n/UiTranslationContext';
import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { ArtifactQualityReport, ArtifactQualityExportabilityState } from '../../../services/quality';
import { tierLabel } from '../../../services/quality/artifactQualityModel';
import { MOTION } from '../../../lib/designTokens';

export interface ArtifactQualityPanelProps {
  open: boolean;
  report: ArtifactQualityReport | null | undefined;
  exportability?: ArtifactQualityExportabilityState | null;
  isRepairing?: boolean;
  onClose: () => void;
  onAutoRepairDocument?: () => void;
  onAutoImproveDiagram?: () => void;
  onApplyRecommendation?: (recommendationId: string) => void;
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;
type QualityDimensions = ArtifactQualityReport['dimensions'];

const severityDot: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-amber-500',
  medium: 'bg-yellow-400',
  low: 'bg-gray-400',
  info: 'bg-sky-400',
};

const severityLabel: Record<string, string> = {
  critical: 'Críticos',
  high: 'Altos',
  medium: 'Medios',
  low: 'Bajos',
  info: 'Informativos',
};

const toneForScore = (score: number): string =>
  score >= 90 ? 'text-emerald-700 dark:text-emerald-300'
    : score >= 75 ? 'text-blue-700 dark:text-blue-300'
      : score >= 60 ? 'text-amber-700 dark:text-amber-300'
        : 'text-red-700 dark:text-red-300';

const gateColour = (passed: boolean, risk: string): string => {
  if (!passed) return 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300';
  if (risk === 'medium') return 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300';
  return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300';
};

/**
 * Unified quality panel.
 *
 * Displays the overall score, per-dimension breakdown, findings grouped by
 * severity, recommendations and the per-family export gate state. Designed
 * to coexist with the existing DiagramQualityPanel — the two can be
 * surfaced together; this one is artifact-scoped, the other diagram-scoped.
 */
export const ArtifactQualityPanel: React.FC<ArtifactQualityPanelProps> = ({
  open,
  report,
  exportability,
  isRepairing,
  onClose,
  onAutoRepairDocument,
  onAutoImproveDiagram,
  onApplyRecommendation,
}) => {
  const t = useUiTranslation();
  const dimensionsByScope = useMemo(() => {
    if (!report) return [] as Array<[string, QualityDimensions]>;
    const grouped = new Map<string, QualityDimensions>();
    for (const dim of report.dimensions) {
      const list = grouped.get(dim.scope) ?? [];
      list.push(dim);
      grouped.set(dim.scope, list);
    }
    return Array.from(grouped.entries());
  }, [report]);

  return (
    <AnimatePresence>
      {open && report && (
        <motion.aside
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: MOTION.duration.fast }}
          role="complementary"
          aria-label={t("ui.calidad-del-artefacto.4216d8")}
          className="absolute top-20 right-4 z-30 w-[380px] max-h-[calc(100%-8rem)] overflow-y-auto bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-4"
        >
          <header className="flex items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                {t("ui.calidad-del-artefacto.4216d8")}
              </p>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {report.score.unmeasured ? t("iniKpi.unmeasured") : `${report.score.value}/100 · ${tierLabel(report.score.tier)}`}
              </h3>
              <p className="text-[11px] text-gray-500 dark:text-gray-400">
                {t("ui.perfil.964c0a")} {report.profile.label}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              title={t("ui.cerrar-panel.e9f9b4")}
            >
              {t("sdd.close")}
            </button>
          </header>

          <p className="text-xs text-gray-600 dark:text-gray-300 mb-3 leading-snug">
            {report.score.summary}
          </p>

          <div className="grid grid-cols-2 gap-2 mb-3">
            {report.document && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                <p className="text-[9px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("ui.documento.8ae11c")}</p>
                <p className={`text-sm font-semibold ${toneForScore(report.document.score)}`}>{report.document.score}/100</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">{report.document.wordCount} {t("ui.palabras.6b05dc")}</p>
              </div>
            )}
            {report.diagram && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                <p className="text-[9px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("lucid.diagramView")}</p>
                <p className={`text-sm font-semibold ${toneForScore(report.diagram.score)}`}>{report.diagram.score}/100</p>
                <p className="text-[10px] text-gray-500 dark:text-gray-400">{report.diagram.issueCount} {t("ui.hallazgo-s.51acab")}</p>
              </div>
            )}
            {report.tables && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 col-span-2">
                <p className="text-[9px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("ui.tablas.54f708")}</p>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  {report.tables.count} · {(report.tables.completeness * 100).toFixed(0)}{t("ui.completas.07d7da")}
                </p>
              </div>
            )}
          </div>

          {exportability && (
            <section aria-label={t("ui.estado-de-exportabilidad.46fd40")} className="mb-3 space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                {t("ui.exportabilidad.8a3c9b")}
              </p>
              {(['document', 'diagram', 'table'] as const).map((kind) => {
                const gate = exportability[kind];
                return (
                  <div
                    key={kind}
                    className={`text-[11px] rounded-md px-2 py-1.5 ${gateColour(gate.passed, gate.risk)}`}
                  >
                    <strong className="capitalize">{kind === 'table' ? t("ui.tablas.54f708") : kind === 'diagram' ? t("lucid.diagramView") : t("ui.documento.8ae11c")}: </strong>
                    {gate.message}
                  </div>
                );
              })}
            </section>
          )}

          <div className="flex flex-wrap gap-2 mb-3">
            {onAutoRepairDocument && (
              <button
                type="button"
                onClick={onAutoRepairDocument}
                disabled={isRepairing}
                className="flex-1 min-w-[140px] px-2 py-1.5 rounded-lg text-[11px] font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200 hover:bg-primary-200 dark:hover:bg-primary-900/60 disabled:opacity-60 disabled:cursor-wait"
                title={t("ui.aplica-reparaciones-determin.571585")}
              >
                {isRepairing ? t("uiExpr.reparando.775b8e") : t("uiExpr.auto-reparar-documento.5682b8")}
              </button>
            )}
            {onAutoImproveDiagram && report.diagram && (
              <button
                type="button"
                onClick={onAutoImproveDiagram}
                disabled={isRepairing}
                className="flex-1 min-w-[140px] px-2 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 disabled:opacity-60 disabled:cursor-wait"
              >
                {t("ui.auto-mejorar-diagrama.6b16b8")}
              </button>
            )}
          </div>

          {dimensionsByScope.length > 0 && (
            <section className="mb-3">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                {t("ui.dimensiones-evaluadas.19b221")}
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {report.dimensions.map((dim) => (
                  <div key={dim.id} className="rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1.5">
                    <p className="text-[9px] uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate">
                      {dim.label}
                    </p>
                    <p className={`text-sm font-semibold ${toneForScore(dim.score)}`}>{dim.score}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {report.issues.length > 0 ? (
            <section className="space-y-3">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t("ui.hallazgos.c1d4c1")} {report.issues.length}
              </p>
              {SEVERITY_ORDER.map((sev) => {
                const group = report.issues.filter((i) => i.severity === sev);
                if (group.length === 0) return null;
                return (
                  <div key={sev}>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                      {severityLabel[sev]} · {group.length}
                    </p>
                    <div className="space-y-2">
                      {group.slice(0, 4).map((issue) => (
                        <div key={issue.id} className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-2">
                          <div className="flex items-start gap-2">
                            <span className={`mt-1 inline-block w-2 h-2 rounded-full flex-shrink-0 ${severityDot[sev]}`} />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-800 dark:text-gray-100">{issue.message}</p>
                              <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">{issue.recommendation}</p>
                              {issue.autoFixable && onApplyRecommendation && (
                                <button
                                  type="button"
                                  onClick={() => onApplyRecommendation(`rec.${issue.id}`)}
                                  className="mt-1.5 px-2 py-1 rounded-md text-[10px] font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200 hover:bg-primary-200 dark:hover:bg-primary-900/60"
                                >
                                  {t("ui.aplicar-fix-rapido.62503b")}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ) : (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              {t("ui.sin-hallazgos-excelente-base.6f5b49")}
            </p>
          )}

          {report.recommendations.length > 0 && (
            <section className="mt-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                {t("ui.proximos-pasos.afb25f")}
              </p>
              <ul className="space-y-1.5">
                {report.recommendations.map((rec) => (
                  <li key={rec.id} className="text-[11px] text-gray-700 dark:text-gray-200">
                    <strong>{rec.title}</strong> — {rec.detail}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

export default ArtifactQualityPanel;

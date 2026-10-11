import { useUiTranslation } from '../../../lib/i18n/UiTranslationContext';
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { GenerationTrace } from '../../../lib/artifacts/contracts';
import type { ArtifactCompilerSummary, CompilationFreshness } from '../../../services/artifactCompiler';
import { MOTION } from '../../../lib/designTokens';

export interface GenerationTracePanelProps {
  open: boolean;
  trace: GenerationTrace | undefined;
  /** Artifact Compilation Engine summary (contract, score, status, gaps). */
  compilation?: ArtifactCompilerSummary;
  /**
   * Live freshness of `compilation` against the artifact's current content.
   * `stale`/`missing` warns the reviewer the summary predates the latest edit.
   */
  compilationFreshness?: CompilationFreshness;
  qualityScoreFallback?: number;
  renderDiagnosticsSummary?: string | null;
  diagnosticReport?: string | null;
  diagnosticCopied: boolean;
  onCopyDiagnosticReport: () => void;
  onClose: () => void;
}

const COMPILER_STATUS_LABEL: Record<ArtifactCompilerSummary['compilerStatus'], string> = {
  passed: 'Aprobado',
  warning: 'Con advertencias',
  repaired: 'Reparado',
  failed: 'Falló',
  blocked: 'Bloqueado',
};

const COMPILER_TIER_LABEL: Record<ArtifactCompilerSummary['compilerTier'], string> = {
  'world-class': 'Clase mundial',
  ready: 'Listo',
  'usable-with-warnings': 'Usable con advertencias',
  'needs-improvement': 'Requiere mejoras',
  blocked: 'Bloqueado',
};

const COMPILATION_FRESHNESS_LABEL: Record<CompilationFreshness, string> = {
  current: 'Vigente',
  stale: 'Desactualizada',
  missing: 'Sin compilar',
};

const COMPILATION_FRESHNESS_CLASS: Record<CompilationFreshness, string> = {
  current: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  stale: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  missing: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

/**
 * Right-aligned aside that surfaces the generation trace recorded by the AI
 * pipeline: status, source, duration, model effective, original request,
 * decisions and errors. Extracted from `ArtifactCanvas` so Phase 4 can reuse
 * the same panel in the workspace shell.
 */
export const GenerationTracePanel: React.FC<GenerationTracePanelProps> = ({
  open,
  trace,
  compilation,
  compilationFreshness,
  qualityScoreFallback,
  renderDiagnosticsSummary,
  diagnosticReport,
  diagnosticCopied,
  onCopyDiagnosticReport,
  onClose,
}) => {
  const t = useUiTranslation();
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: -24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -24, opacity: 0 }}
          transition={{ duration: MOTION.duration.fast }}
          role="complementary"
          aria-label={t("ui.observabilidad-de-generacion.ec74b9")}
          className="absolute top-20 left-4 z-30 w-[380px] max-w-[calc(100%-2rem)] max-h-[calc(100%-10rem)] overflow-y-auto bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-4"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                {t("ui.observabilidad.2ea551")}
              </p>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("ui.como-se-genero-este-artefact.b9cac6")}
              </h3>
            </div>
            <button
              onClick={onClose}
              className="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              title={t("ui.ocultar-observabilidad.6b72ab")}
            >
              {t("sdd.close")}
            </button>
          </div>

          {trace ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("diagramInspector.status")}</p>
                  <p className="mt-1 text-sm font-semibold capitalize text-gray-900 dark:text-white">{trace.status}</p>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("ui.fuente.f00fca")}</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{trace.source}</p>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("ui.duracion.63ce53")}</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                    {trace.durationMs ? `${Math.round(trace.durationMs / 1000)}s` : 'N/D'}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("ui.calidad.b2e6a4")}</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                    {trace.quality?.score ?? qualityScoreFallback ?? 'N/D'}/100
                  </p>
                </div>
              </div>

              {(trace.operationId || trace.id) && (
                <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                  {t("ui.operationid.facbda")} {trace.operationId ?? trace.id}
                </p>
              )}

              {(trace.quality?.initialScore !== undefined || trace.quality?.finalScore !== undefined) && (
                <div className="rounded-xl border border-primary-100 bg-primary-50/60 p-3 dark:border-primary-900/60 dark:bg-primary-950/20">
                  <p className="text-[10px] uppercase tracking-wider text-primary-700 dark:text-primary-300">
                    {t("ui.refinamiento-semantico.381241")}
                  </p>
                  <p className="mt-1 text-xs text-gray-700 dark:text-gray-200">
                    {t("ui.inicial.e7d704")} <span className="font-semibold">{trace.quality.initialScore ?? 'N/D'}/100</span>
                    {' · '}{t("ui.final.464a59")} <span className="font-semibold">{trace.quality.finalScore ?? trace.quality.score ?? 'N/D'}/100</span>
                    {' · '}{t("ui.pasadas.20cf78")} <span className="font-semibold">{trace.quality.refinementPasses ?? 0}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                    {trace.quality.refinementAccepted ? t("uiExpr.contenido-refinado-aceptado.7e2991") : t("uiExpr.se-conservo-la-version-valid.173883")}
                    {trace.quality.refinementUsedAI ? t("uiExpr.incluyo-ia-controlada.03d584") : t("uiExpr.solo-deterministico-o-sin-ia.e67c33")}
                  </p>
                </div>
              )}

              {(trace.modelEffective || trace.model) && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">{t("ui.modelo-ia-efectivo.f67c5a")}</p>
                  {trace.modelEffective ? (
                    <>
                      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                        {trace.modelEffective.id}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                        {t("ui.fuente.fac584")}{' '}
                        <span className="font-medium text-gray-700 dark:text-gray-200">
                          {trace.modelEffective.source}
                        </span>
                        {' · '}{t("ui.tier.ac7c78")}{' '}
                        <span className="font-medium text-gray-700 dark:text-gray-200">
                          {trace.modelEffective.tier}
                        </span>
                        {trace.modelEffective.requested
                          && trace.modelEffective.requested !== trace.modelEffective.id && (
                            <>
                              {' '}{t("ui.preferencia.ba98a7")}{' '}
                              <span className="font-medium text-gray-700 dark:text-gray-200">
                                {trace.modelEffective.requested}
                              </span>
                            </>
                          )}
                      </p>
                    </>
                  ) : (
                    <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{trace.model}</p>
                  )}
                </div>
              )}

              {trace.request && (
                <div className="rounded-xl bg-primary-50/70 dark:bg-primary-950/25 border border-primary-100 dark:border-primary-900/60 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-primary-700 dark:text-primary-300">
                    {t("ui.solicitud-original.30e861")}
                  </p>
                  <p className="mt-1 text-xs text-gray-700 dark:text-gray-200 leading-snug">
                    {trace.request.userRequest}
                  </p>
                  {trace.request.matchedCatalogTemplateName && (
                    <p className="mt-2 text-[11px] text-primary-700 dark:text-primary-300">
                      {t("ui.estandar-usado.ff2436")} {trace.request.matchedCatalogTemplateName}
                    </p>
                  )}
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  {t("ui.decisiones-tomadas.61eee8")}
                </p>
                <div className="space-y-2">
                  {trace.decisions.map((step, index) => (
                    <div key={`${step.stage}-${index}`} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-gray-900 dark:text-white">{step.stage}</p>
                        <span className="text-[10px] uppercase text-gray-500 dark:text-gray-400">{step.status}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
                        {step.message}
                      </p>
                      {step.detail && (
                        <p className="mt-1 text-[10px] text-gray-500 dark:text-gray-400 leading-snug">
                          {step.detail}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  {t("ui.errores-advertencias.a6e4cc")}
                </p>
                {trace.errors.length > 0 ? (
                  <div className="space-y-2">
                    {trace.errors.map((step, index) => (
                      <div
                        key={`${step.stage}-error-${index}`}
                        className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 p-2"
                      >
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">
                          {step.stage} · {step.status}
                        </p>
                        <p className="mt-1 text-[11px] text-amber-800 dark:text-amber-100 leading-snug">
                          {step.message}
                        </p>
                        {step.detail && (
                          <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-200/80 leading-snug">
                            {step.detail}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700 dark:text-emerald-300">
                    {t("ui.sin-errores-registrados-en-l.6233c3")}
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              {t("ui.este-artefacto-no-tiene-traz.21bd56")}
            </p>
          )}

          {compilation && (
            <section
              aria-label={t("ui.resultado-del-motor-de-compi.624b46")}
              className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                  {t("ui.motor-de-compilacion.dbad1a")}
                </p>
                {compilationFreshness && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${COMPILATION_FRESHNESS_CLASS[compilationFreshness]}`}
                    title={t("ui.frescura-de-la-compilacion-r.dfcf2a")}
                  >
                    {COMPILATION_FRESHNESS_LABEL[compilationFreshness]}
                  </span>
                )}
              </div>
              {compilationFreshness && compilationFreshness !== 'current' && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                  {t("ui.la-compilacion-mostrada-pued.65abce")}
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {COMPILER_STATUS_LABEL[compilation.compilerStatus]}
                </span>
                <span className="text-sm font-semibold text-gray-900 dark:text-white">
                  {compilation.compilerScore}/100
                </span>
              </div>
              <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
                {t("ui.contrato.e1a1c6")} {compilation.compilerContractLabel} {t("ui.nivel.cd06ec")}{' '}
                {COMPILER_TIER_LABEL[compilation.compilerTier]}
              </p>
              <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
                {t("ui.hallazgos-criticos.97bc07")} {compilation.compilerIssues.critical} {t("ui.altos.cb717e")}{' '}
                {compilation.compilerIssues.high} {t("ui.medios.e48f26")} {compilation.compilerIssues.medium} {t("ui.bajos.0cdc10")} {compilation.compilerIssues.low}
              </p>
              <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
                {t("ui.exportable-documento.e03683")} {compilation.exportReadiness.document ? 'Sí' : 'No'} {t("ui.diagrama.926170")} {compilation.exportReadiness.diagram ? 'Sí' : 'No'} {t("ui.tabla.72d206")}{' '}
                {compilation.exportReadiness.table ? 'Sí' : 'No'}
              </p>
              {compilation.compilerRepairs.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t("ui.reparaciones-aplicadas.2b072f")}
                  </p>
                  <ul className="mt-1 list-disc list-inside text-[11px] text-gray-600 dark:text-gray-300">
                    {compilation.compilerRepairs.map((repairItem) => (
                      <li key={repairItem}>{repairItem}</li>
                    ))}
                  </ul>
                </div>
              )}
              {compilation.compilerRecommendations.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    {t("kg.recommendations")}
                  </p>
                  <ul className="mt-1 list-disc list-inside text-[11px] text-gray-600 dark:text-gray-300">
                    {compilation.compilerRecommendations.map((recommendation) => (
                      <li key={recommendation}>{recommendation}</li>
                    ))}
                  </ul>
                </div>
              )}
              {compilation.requiresHumanReview && (
                <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                  {t("ui.requiere-revision-humana-ant.d03230")}
                </p>
              )}
            </section>
          )}

          {(renderDiagnosticsSummary || diagnosticReport) && (
            <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              {renderDiagnosticsSummary && (
                <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
                  {t("ui.diagnostico-render.c80cb6")} {renderDiagnosticsSummary}
                </p>
              )}
              <button
                onClick={onCopyDiagnosticReport}
                disabled={!diagnosticReport}
                className="w-full px-3 py-2 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {diagnosticCopied ? t("uiExpr.reporte-copiado.89dc78") : t("uiExpr.copiar-reporte-tecnico.dbc88b")}
              </button>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

export default GenerationTracePanel;

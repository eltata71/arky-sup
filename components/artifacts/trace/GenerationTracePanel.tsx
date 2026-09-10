import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { GenerationTrace } from '../../../lib/artifacts/contracts';
import type { ArtifactCompilerSummary, CompilationFreshness } from '../../../services/artifactCompiler';

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
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ x: -24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -24, opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="complementary"
          aria-label="Observabilidad de generación"
          className="absolute top-20 left-4 z-30 w-[380px] max-w-[calc(100%-2rem)] max-h-[calc(100%-10rem)] overflow-y-auto bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-4"
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                Observabilidad
              </p>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                Cómo se generó este artefacto
              </h3>
            </div>
            <button
              onClick={onClose}
              className="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              title="Ocultar observabilidad"
            >
              Cerrar
            </button>
          </div>

          {trace ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Estado</p>
                  <p className="mt-1 text-sm font-semibold capitalize text-gray-900 dark:text-white">{trace.status}</p>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Fuente</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{trace.source}</p>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Duración</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                    {trace.durationMs ? `${Math.round(trace.durationMs / 1000)}s` : 'N/D'}
                  </p>
                </div>
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Calidad</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                    {trace.quality?.score ?? qualityScoreFallback ?? 'N/D'}/100
                  </p>
                </div>
              </div>

              {(trace.operationId || trace.id) && (
                <p className="text-[10px] font-mono text-gray-500 dark:text-gray-400">
                  operationId: {trace.operationId ?? trace.id}
                </p>
              )}

              {(trace.quality?.initialScore !== undefined || trace.quality?.finalScore !== undefined) && (
                <div className="rounded-xl border border-primary-100 bg-primary-50/60 p-3 dark:border-primary-900/60 dark:bg-primary-950/20">
                  <p className="text-[10px] uppercase tracking-wider text-primary-700 dark:text-primary-300">
                    Refinamiento semántico
                  </p>
                  <p className="mt-1 text-xs text-gray-700 dark:text-gray-200">
                    Inicial: <span className="font-semibold">{trace.quality.initialScore ?? 'N/D'}/100</span>
                    {' · '}Final: <span className="font-semibold">{trace.quality.finalScore ?? trace.quality.score ?? 'N/D'}/100</span>
                    {' · '}Pasadas: <span className="font-semibold">{trace.quality.refinementPasses ?? 0}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-gray-600 dark:text-gray-300">
                    {trace.quality.refinementAccepted ? 'Contenido refinado aceptado antes de persistir.' : 'Se conservó la versión validada sin reemplazo de refinamiento.'}
                    {trace.quality.refinementUsedAI ? ' Incluyó IA controlada.' : ' Sólo determinístico o sin IA.'}
                  </p>
                </div>
              )}

              {(trace.modelEffective || trace.model) && (
                <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">Modelo IA efectivo</p>
                  {trace.modelEffective ? (
                    <>
                      <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                        {trace.modelEffective.id}
                      </p>
                      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">
                        Fuente:{' '}
                        <span className="font-medium text-gray-700 dark:text-gray-200">
                          {trace.modelEffective.source}
                        </span>
                        {' · '}Tier:{' '}
                        <span className="font-medium text-gray-700 dark:text-gray-200">
                          {trace.modelEffective.tier}
                        </span>
                        {trace.modelEffective.requested
                          && trace.modelEffective.requested !== trace.modelEffective.id && (
                            <>
                              {' '}· Preferencia:{' '}
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
                    Solicitud original
                  </p>
                  <p className="mt-1 text-xs text-gray-700 dark:text-gray-200 leading-snug">
                    {trace.request.userRequest}
                  </p>
                  {trace.request.matchedCatalogTemplateName && (
                    <p className="mt-2 text-[11px] text-primary-700 dark:text-primary-300">
                      Estándar usado: {trace.request.matchedCatalogTemplateName}
                    </p>
                  )}
                </div>
              )}

              <div>
                <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                  Decisiones tomadas
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
                  Errores / advertencias
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
                    Sin errores registrados en la generación.
                  </p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              Este artefacto no tiene traza de generación persistida. Puede haber sido creado antes
              de activar la observabilidad; se muestran diagnósticos de render en el reporte copiable.
            </p>
          )}

          {compilation && (
            <section
              aria-label="Resultado del motor de compilación de artefactos"
              className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                  Motor de compilación
                </p>
                {compilationFreshness && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${COMPILATION_FRESHNESS_CLASS[compilationFreshness]}`}
                    title="Frescura de la compilación respecto al contenido actual del artefacto."
                  >
                    {COMPILATION_FRESHNESS_LABEL[compilationFreshness]}
                  </span>
                )}
              </div>
              {compilationFreshness && compilationFreshness !== 'current' && (
                <p className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">
                  La compilación mostrada puede no reflejar la última edición; vuelve a guardar el
                  artefacto para recompilarlo.
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
                Contrato: {compilation.compilerContractLabel} · Nivel:{' '}
                {COMPILER_TIER_LABEL[compilation.compilerTier]}
              </p>
              <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
                Hallazgos — Críticos: {compilation.compilerIssues.critical} · Altos:{' '}
                {compilation.compilerIssues.high} · Medios: {compilation.compilerIssues.medium} ·
                Bajos: {compilation.compilerIssues.low}
              </p>
              <p className="text-[11px] text-gray-600 dark:text-gray-300 leading-snug">
                Exportable — Documento: {compilation.exportReadiness.document ? 'Sí' : 'No'} ·
                Diagrama: {compilation.exportReadiness.diagram ? 'Sí' : 'No'} · Tabla:{' '}
                {compilation.exportReadiness.table ? 'Sí' : 'No'}
              </p>
              {compilation.compilerRepairs.length > 0 && (
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Reparaciones aplicadas
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
                    Recomendaciones
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
                  Requiere revisión humana antes de compartir o exportar.
                </p>
              )}
            </section>
          )}

          {(renderDiagnosticsSummary || diagnosticReport) && (
            <div className="mt-4 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
              {renderDiagnosticsSummary && (
                <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
                  Diagnóstico render: {renderDiagnosticsSummary}
                </p>
              )}
              <button
                onClick={onCopyDiagnosticReport}
                disabled={!diagnosticReport}
                className="w-full px-3 py-2 rounded-lg text-xs font-semibold bg-gray-900 text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100"
              >
                {diagnosticCopied ? 'Reporte copiado' : 'Copiar reporte técnico'}
              </button>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

export default GenerationTracePanel;

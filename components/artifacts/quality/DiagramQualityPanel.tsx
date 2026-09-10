import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { DiagramQualityReport } from '../../../services/diagram';
import type { DiagramSuggestion, SuggestionCategory } from '../../../services/diagram/diagramTypeQualityGates';

const ARCHETYPE_LABEL: Record<string, string> = {
  context: 'Diagrama de Contexto',
  container: 'Diagrama de Contenedores',
  component: 'Diagrama de Componentes',
  integration: 'Diagrama de Integración',
  process: 'Diagrama de Proceso',
  data: 'Diagrama de Datos',
  deployment: 'Diagrama de Despliegue',
  sequence: 'Diagrama de Secuencia',
  generic: 'Diagrama',
};

const CATEGORY_LABEL: Record<SuggestionCategory, string> = {
  classification: 'Clasificación',
  'integration-contract': 'Contrato de integración',
  security: 'Seguridad',
  observability: 'Observabilidad',
  narrative: 'Narrativa',
  layout: 'Layout',
  completeness: 'Completitud',
  'process-flow': 'Flujo de proceso',
  'data-lineage': 'Linaje de datos',
};

const SUGGESTION_SEVERITY_DOT: Record<DiagramSuggestion['severity'], string> = {
  critical: 'bg-red-500',
  high: 'bg-amber-500',
  medium: 'bg-yellow-400',
  low: 'bg-sky-400',
  info: 'bg-gray-400',
};
const VISUAL_GATE_BADGE: Record<'ready' | 'warnings' | 'blocked', string> = {
  ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  warnings: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  blocked: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

// Friendly labels for the 10-dimension breakdown so the UI does not surface
// camelCase identifiers to architects.
const DIMENSION_LABEL_ES: Record<string, string> = {
  claridadSemantica: 'Claridad semántica',
  consistenciaArquitectonica: 'Consistencia arquitectónica',
  jerarquiaVisual: 'Jerarquía visual',
  legibilidad: 'Legibilidad',
  narrativa: 'Narrativa',
  atractivoVisual: 'Atractivo visual',
  preparacionEjecutiva: 'Preparación ejecutiva',
  preparacionTecnica: 'Preparación técnica',
  exportabilidad: 'Exportabilidad',
  mantenibilidadPipeline: 'Mantenibilidad',
};

export interface DiagramQualityPanelProps {
  open: boolean;
  qualityReport: DiagramQualityReport | null | undefined;
  isAutoImproving: boolean;
  onClose: () => void;
  onAutoImprove: () => void;
  onGenerateWorldClass: () => void;
  onApplyIssueFix: (issueId: string) => void;
  /**
   * Brecha 4: invoked when the user clicks a chip in the Visual Quality
   * Gate's `safeAutomaticActions` list. The consumer decides which action
   * codes are actionable; unbound codes can fall back to a toast/info.
   */
  onApplyAutoAction?: (actionCode: string) => void;
}

const severityOrder = ['critical', 'high', 'medium', 'low'] as const;

export const DiagramQualityPanel: React.FC<DiagramQualityPanelProps> = ({
  open,
  qualityReport,
  isAutoImproving,
  onClose,
  onAutoImprove,
  onGenerateWorldClass,
  onApplyIssueFix,
  onApplyAutoAction,
}) => {
  return (
    <AnimatePresence>
      {open && qualityReport && (
        <motion.aside
          initial={{ x: 24, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 24, opacity: 0 }}
          transition={{ duration: 0.18 }}
          role="complementary"
          aria-label="Calidad del diagrama"
          className="absolute top-20 right-4 z-30 w-[360px] max-h-[calc(100%-10rem)] overflow-y-auto bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl p-4"
        >
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                Calidad del diagrama
              </p>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                {qualityReport.score}/100
              </h3>
            </div>
            <button
              onClick={onClose}
              className="text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              title="Ocultar panel de calidad"
            >
              Cerrar
            </button>
          </div>
          <p className="text-xs text-gray-600 dark:text-gray-300 mb-2 leading-snug">
            {qualityReport.summary}
          </p>
          {qualityReport.visualGate && (
            <div className="mb-3 rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Visual Quality Gate 2.0
                </p>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${VISUAL_GATE_BADGE[qualityReport.visualGate.state]}`}>
                  {qualityReport.visualGate.state}
                </span>
              </div>
              <p className="text-xs font-semibold text-gray-900 dark:text-white mt-1">
                {qualityReport.visualGate.score}/100
              </p>
              <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-1 leading-snug">
                {qualityReport.visualGate.rationale}
              </p>
              {qualityReport.visualGate.signals.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {qualityReport.visualGate.signals.slice(0, 3).map((signal) => (
                    <li key={signal.code} className="text-[11px] text-gray-700 dark:text-gray-200 leading-snug">
                      • <span className="font-medium">{signal.code}:</span> {signal.message}
                    </li>
                  ))}
                </ul>
              )}
              {qualityReport.visualGate.safeAutomaticActions.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1">
                    Acciones automáticas seguras
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {qualityReport.visualGate.safeAutomaticActions.slice(0, 6).map((action) => {
                      const baseClasses = 'text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800';
                      if (!onApplyAutoAction) {
                        return (
                          <span
                            key={action}
                            className={baseClasses}
                            title="El gate sugiere esta acción como segura para aplicar automáticamente"
                          >
                            {action}
                          </span>
                        );
                      }
                      return (
                        <button
                          key={action}
                          type="button"
                          onClick={() => onApplyAutoAction(action)}
                          className={`${baseClasses} hover:bg-emerald-100 dark:hover:bg-emerald-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 cursor-pointer transition-colors`}
                          title={`Aplicar ${action}`}
                          aria-label={`Aplicar acción ${action}`}
                        >
                          {action}
                        </button>
                      );
                    })}
                    {qualityReport.visualGate.safeAutomaticActions.length > 6 && (
                      <span className="text-[10px] italic text-gray-500 dark:text-gray-400">
                        +{qualityReport.visualGate.safeAutomaticActions.length - 6} más
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          {qualityReport.score < 90 && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mb-3 leading-snug">
              Causa probable: {(() => {
                const lowest = Object.entries(qualityReport.breakdown)
                  .sort((a, b) => (a[1] as number) - (b[1] as number))[0];
                return `dimensión más baja "${DIMENSION_LABEL_ES[lowest?.[0] ?? ''] ?? lowest?.[0]}" (${lowest?.[1]}/100).`;
              })()}
            </p>
          )}
          <div className="flex gap-2 mb-3">
            <button
              onClick={onAutoImprove}
              disabled={isAutoImproving}
              className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 disabled:opacity-60 disabled:cursor-wait"
              title="Aplica reparaciones determinísticas: orphans, labels, grupos, metadata."
            >
              {isAutoImproving ? 'Mejorando…' : 'Auto-mejorar diagrama'}
            </button>
            <button
              onClick={onGenerateWorldClass}
              className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200 hover:bg-primary-200 dark:hover:bg-primary-900/60"
              title="Genera una nueva versión de clase mundial pasando por el quality gate completo."
            >
              Generar clase mundial
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 mb-3">
            {Object.entries(qualityReport.breakdown).map(([k, v]) => {
              const score = v as number;
              const tone = score >= 90 ? 'text-emerald-700 dark:text-emerald-300'
                : score >= 75 ? 'text-blue-700 dark:text-blue-300'
                : score >= 60 ? 'text-amber-700 dark:text-amber-300'
                : 'text-red-700 dark:text-red-300';
              return (
                <div key={k} className="rounded-lg border border-gray-200 dark:border-gray-700 px-2 py-1.5">
                  <p                     className="text-[9px] uppercase tracking-wider text-gray-500 dark:text-gray-400 truncate"
                  >
                    {DIMENSION_LABEL_ES[k] ?? k}
                  </p>
                  <p className={`text-sm font-semibold ${tone}`}>{score}</p>
                </div>
              );
            })}
          </div>
          {qualityReport.archetype && (
            <p className="text-[10px] uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400 mb-2">
              Arquetipo detectado · {ARCHETYPE_LABEL[qualityReport.archetype] ?? qualityReport.archetype}
            </p>
          )}

          {qualityReport.suggestions && qualityReport.suggestions.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Sugerencias por arquetipo · {qualityReport.suggestions.length}
              </p>
              <div className="space-y-2">
                {qualityReport.suggestions.slice(0, 6).map((sugg) => (
                  <div key={sugg.id} className="rounded-lg border border-gray-200 dark:border-gray-700 p-2">
                    <div className="flex items-start gap-2">
                      <span className={`mt-1 inline-block w-2 h-2 rounded-full flex-shrink-0 ${SUGGESTION_SEVERITY_DOT[sugg.severity]}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="text-[12px] font-semibold text-gray-800 dark:text-gray-100">{sugg.title}</p>
                          <span className="text-[9px] font-semibold uppercase tracking-wider px-1 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-700/60 dark:text-gray-300">
                            {CATEGORY_LABEL[sugg.category]}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5 leading-snug">{sugg.justification}</p>
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1 leading-snug">
                          → {sugg.recommendedAction}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                {qualityReport.suggestions.length > 6 && (
                  <p className="text-[10px] italic text-gray-400">…y {qualityReport.suggestions.length - 6} más</p>
                )}
              </div>
            </div>
          )}

          {qualityReport.issues.length > 0 ? (
            <div className="space-y-3">
              {severityOrder.map((sev) => {
                const group = qualityReport.issues.filter((i) => i.severity === sev);
                if (group.length === 0) return null;
                const sevLabel = sev === 'critical' ? 'Críticos'
                  : sev === 'high' ? 'Altos'
                  : sev === 'medium' ? 'Medios'
                  : 'Bajos';
                const sevDot = sev === 'critical' ? 'bg-red-500'
                  : sev === 'high' ? 'bg-amber-500'
                  : sev === 'medium' ? 'bg-yellow-400'
                  : 'bg-gray-400';
                return (
                  <div key={sev}>
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                      Hallazgos {sevLabel} · {group.length}
                    </p>
                    <div className="space-y-2">
                      {group.map((issue) => (
                        <div key={issue.id} className="rounded-lg bg-gray-50 dark:bg-gray-800/60 p-2">
                          <div className="flex items-start gap-2">
                            <span className={`mt-0.5 inline-block w-2 h-2 rounded-full flex-shrink-0 ${sevDot}`} />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-gray-800 dark:text-gray-100">{issue.message}</p>
                              <p className="text-[11px] text-gray-600 dark:text-gray-300 mt-0.5">{issue.recommendation}</p>
                              <button
                                onClick={() => onApplyIssueFix(issue.id)}
                                className="mt-1.5 px-2 py-1 rounded-md text-[10px] font-medium bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-200 hover:bg-primary-200 dark:hover:bg-primary-900/60"
                              >
                                Aplicar fix rápido
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-emerald-700 dark:text-emerald-300">
              Sin hallazgos. Excelente base para exportación.
            </p>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

export default DiagramQualityPanel;

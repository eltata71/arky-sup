import React from 'react';
import { Drawer } from '../../ui/Drawer';
import { Spinner } from '../../ui/Spinner';
import {
  ArrowPathIcon,
  CheckBadgeIcon,
  ExclamationTriangleIcon,
  LightBulbIcon,
  SparklesIcon,
} from '../../Icons';
import {
  EFFORT_LABEL_ES,
  GAP_TYPE_LABEL_ES,
  IMPACT_LABEL_ES,
  type ArtifactSuggestion,
  type ArtifactSuggestionAction,
  type ArtifactSuggestionReport,
} from '../../../services/ai/artifactSuggestionService';
import type { ArtifactSuggestionsStatus } from '../../../hooks/artifacts/useArtifactSuggestions';

export interface ArtifactSuggestionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  artifactName: string;
  status: ArtifactSuggestionsStatus;
  report: ArtifactSuggestionReport | null;
  error: string | null;
  /** Runs (or re-runs) the AI analysis. */
  onAnalyze: () => void;
  /** "Mejorar con IA" — applies the loaded suggestions to the artifact. */
  onApplyWithAI: () => void;
  canApplyWithAI: boolean;
  isApplyingWithAI: boolean;
  /** "Mejorar automáticamente" — deterministic quality gate (diagram only). */
  onAutoImprove: () => void;
  canAutoImprove: boolean;
  isAutoImproving: boolean;
  /** "Generar versión de clase mundial". */
  onGenerateWorldClass: () => void;
  /**
   * Gap 13 — handler for executable actions. When provided, each suggestion
   * with `actions` renders the action buttons; the panel calls this with
   * the action descriptor when the user clicks.
   */
  onRunAction?: (action: ArtifactSuggestionAction, suggestion: ArtifactSuggestion) => void;
}

const IMPACT_TONE: Record<ArtifactSuggestion['impact'], string> = {
  high: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const EFFORT_TONE: Record<ArtifactSuggestion['effort'], string> = {
  low: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  high: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
};

const SuggestionCard: React.FC<{
  suggestion: ArtifactSuggestion;
  index: number;
  onRunAction?: (action: ArtifactSuggestionAction, suggestion: ArtifactSuggestion) => void;
}> = ({ suggestion, index, onRunAction }) => (
  <li className="rounded-xl border border-gray-200 dark:border-gray-700/80 bg-white dark:bg-gray-800/50 p-3.5">
    <div className="flex items-start gap-2.5">
      <span
        className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700 dark:bg-primary-500/20 dark:text-primary-300"
        aria-hidden
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{suggestion.title}</h4>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600 dark:bg-gray-700 dark:text-gray-300">
            {GAP_TYPE_LABEL_ES[suggestion.gapType]}
          </span>
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${IMPACT_TONE[suggestion.impact]}`}>
            Impacto: {IMPACT_LABEL_ES[suggestion.impact]}
          </span>
          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${EFFORT_TONE[suggestion.effort]}`}>
            Esfuerzo: {EFFORT_LABEL_ES[suggestion.effort]}
          </span>
          {suggestion.expectedQualityGain !== null && suggestion.expectedQualityGain > 0 && (
            <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
              +{suggestion.expectedQualityGain} pts est.
            </span>
          )}
        </div>
      </div>
    </div>
    <p className="mt-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
      {suggestion.description}
    </p>
    <div className="mt-2 rounded-lg bg-primary-50/70 px-2.5 py-2 dark:bg-primary-500/10">
      <p className="text-[11px] font-semibold text-primary-700 dark:text-primary-300">
        Acción recomendada
      </p>
      <p className="mt-0.5 text-xs text-gray-700 dark:text-gray-200">{suggestion.recommendedAction}</p>
    </div>
    {suggestion.actions && suggestion.actions.length > 0 && onRunAction && (
      <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Acciones ejecutables">
        {suggestion.actions.map((action, i) => (
          <button
            key={`${action.kind}-${i}`}
            type="button"
            onClick={() => onRunAction(action, suggestion)}
            className="inline-flex items-center gap-1 rounded-md border border-primary-300 bg-primary-50 px-2 py-1 text-[11px] font-semibold text-primary-700 transition-colors hover:bg-primary-100 dark:border-primary-700 dark:bg-primary-900/30 dark:text-primary-200 dark:hover:bg-primary-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            title={action.description ?? action.label}
          >
            <SparklesIcon className="h-3 w-3" />
            {action.label}
          </button>
        ))}
      </div>
    )}
    <p className="mt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      <span className="font-semibold">Evidencia: </span>
      {suggestion.evidence}
    </p>
  </li>
);

/**
 * Side panel for the "Sugerencias" feature. Surfaces an AI quality review of
 * the artifact (prioritized, actionable suggestions) plus a clearly separated
 * section with the automatic AI improvement actions. Handles the idle,
 * loading, error, empty and success states defensively.
 */
export const ArtifactSuggestionsPanel: React.FC<ArtifactSuggestionsPanelProps> = ({
  isOpen,
  onClose,
  artifactName,
  status,
  report,
  error,
  onAnalyze,
  onApplyWithAI,
  canApplyWithAI,
  isApplyingWithAI,
  onAutoImprove,
  canAutoImprove,
  isAutoImproving,
  onGenerateWorldClass,
  onRunAction,
}) => {
  const suggestions = report?.suggestions ?? [];
  const busy = isApplyingWithAI || isAutoImproving;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title="Sugerencias de mejora"
      description={artifactName}
      side="right"
      size="lg"
    >
      <div className="flex flex-col gap-4 p-5">
        {/* ── Sugerencias para el usuario ─────────────────────────────── */}
        <section aria-label="Sugerencias para mejorar el artefacto">
          <div className="mb-2 flex items-center gap-2">
            <LightBulbIcon className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Recomendaciones para ti
            </h3>
          </div>

          {status === 'idle' && (
            <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-4 text-center">
              <p className="text-xs text-gray-600 dark:text-gray-300">
                Analiza el estado actual del artefacto para obtener una lista priorizada de
                acciones concretas que elevan su calidad antes de regenerarlo.
              </p>
              <button
                type="button"
                onClick={onAnalyze}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              >
                <SparklesIcon className="h-4 w-4" />
                Analizar artefacto
              </button>
            </div>
          )}

          {status === 'loading' && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
              <Spinner />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Analizando calidad y contexto del artefacto…
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 dark:border-rose-900/60 dark:bg-rose-950/40">
              <div className="flex items-start gap-2">
                <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-500" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                    No se pudieron generar las sugerencias
                  </p>
                  <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">
                    {error ?? 'El servicio de IA no respondió correctamente.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onAnalyze}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
              >
                <ArrowPathIcon className="h-3.5 w-3.5" />
                Reintentar
              </button>
            </div>
          )}

          {status === 'success' && report && (
            <div className="flex flex-col gap-3">
              <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Estado de calidad
                  </p>
                  {report.currentScore !== null && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 dark:text-gray-200">
                      <CheckBadgeIcon className="h-3.5 w-3.5 text-primary-500" />
                      {report.currentScore}/100
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-gray-700 dark:text-gray-200">
                  {report.qualitySummary}
                </p>
              </div>

              {report.insufficientContext && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/40">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    Contexto insuficiente para sugerencias de alta confianza
                  </p>
                  {report.missingContextHints.length > 0 ? (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] text-amber-700 dark:text-amber-300">
                      {report.missingContextHints.map((hint, idx) => (
                        <li key={idx}>{hint}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                      Aporta más contexto de negocio o técnico y vuelve a analizar.
                    </p>
                  )}
                </div>
              )}

              {suggestions.length > 0 ? (
                <ul className="flex flex-col gap-2.5">
                  {suggestions.map((suggestion, index) => (
                    <SuggestionCard
                      key={suggestion.id}
                      suggestion={suggestion}
                      index={index}
                      onRunAction={onRunAction}
                    />
                  ))}
                </ul>
              ) : (
                !report.insufficientContext && (
                  <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                    Sin recomendaciones pendientes: el artefacto está en buen estado.
                  </p>
                )
              )}

              <button
                type="button"
                onClick={onAnalyze}
                className="inline-flex items-center justify-center gap-1.5 self-start rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <ArrowPathIcon className="h-3.5 w-3.5" />
                Volver a analizar
              </button>
            </div>
          )}
        </section>

        {/* ── Acciones automáticas de IA ──────────────────────────────── */}
        <section
          aria-label="Acciones automáticas de mejora con IA"
          className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 p-3.5"
        >
          <div className="mb-1 flex items-center gap-2">
            <SparklesIcon className="h-4 w-4 text-primary-500" />
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Acciones automáticas de IA
            </h3>
          </div>
          <p className="mb-3 text-[11px] text-gray-500 dark:text-gray-400">
            Aplican mejoras directamente. Cada acción crea una nueva versión: tu versión actual
            se conserva.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={onApplyWithAI}
              disabled={!canApplyWithAI || busy}
              className="flex items-center justify-between gap-2 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <span className="flex items-center gap-2">
                <SparklesIcon className="h-4 w-4" />
                Mejorar con IA
              </span>
              <span className="text-[10px] font-normal opacity-80">
                {isApplyingWithAI ? 'Aplicando…' : 'Aplica las sugerencias'}
              </span>
            </button>
            <button
              type="button"
              onClick={onAutoImprove}
              disabled={!canAutoImprove || busy}
              className="flex items-center justify-between gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            >
              <span className="flex items-center gap-2">
                <CheckBadgeIcon className="h-4 w-4" />
                Mejorar automáticamente
              </span>
              <span className="text-[10px] font-normal opacity-80">
                {isAutoImproving ? 'Mejorando…' : 'Reparación determinística'}
              </span>
            </button>
            <button
              type="button"
              onClick={onGenerateWorldClass}
              disabled={busy}
              className="flex items-center justify-between gap-2 rounded-lg border border-primary-300 bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-primary-800 dark:bg-primary-900/30 dark:text-primary-200 dark:hover:bg-primary-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <span className="flex items-center gap-2">
                <SparklesIcon className="h-4 w-4" />
                Generar versión de clase mundial
              </span>
              <span className="text-[10px] font-normal opacity-80">Regenera con quality gate</span>
            </button>
          </div>
          {!canApplyWithAI && (
            <p className="mt-2 text-[10px] text-gray-400 dark:text-gray-500">
              «Mejorar con IA» se habilita después de analizar el artefacto y obtener sugerencias.
            </p>
          )}
        </section>
      </div>
    </Drawer>
  );
};

export default ArtifactSuggestionsPanel;

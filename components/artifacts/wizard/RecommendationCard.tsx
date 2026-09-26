import React from 'react';
import { CheckCircleIcon } from '../../Icons';
import { CollapsibleSection } from './CollapsibleSection';
import type { ArtifactRecommendationCandidate } from '../../../services/artifacts/domain/artifactRecommendationService';
import { cn } from '../../ui/cn';

interface RecommendationCardProps {
  candidate: ArtifactRecommendationCandidate;
  isSelected: boolean;
  /** When true, the card is presented as the primary suggestion (top-1). */
  isPrimary?: boolean;
  onSelect: () => void;
}

const SCORE_LABELS: Array<{ key: keyof ArtifactRecommendationCandidate['scoreBreakdown']; label: string }> = [
  { key: 'intentMatch', label: 'Intención' },
  { key: 'audienceMatch', label: 'Audiencia' },
  { key: 'representationMatch', label: 'Representación' },
  { key: 'sourceArtifactRelevance', label: 'Fuentes' },
  { key: 'acceptanceCriteriaCoverage', label: 'Criterios' },
  { key: 'architectureGraphAlignment', label: 'Grafo' },
];

/**
 * Card for one recommendation candidate.  The default view shows only what
 * the architect needs to decide: name, type, confidence, rationale and the
 * expected outcome.  The full score breakdown, trade-offs and risks live
 * inside an accessible disclosure ("Ver análisis detallado").
 */
export const RecommendationCard: React.FC<RecommendationCardProps> = ({
  candidate,
  isSelected,
  isPrimary = false,
  onSelect,
}) => {
  const confidencePct = Math.round(candidate.confidence * 100);
  const headingId = `recommendation-${candidate.id}`;
  return (
    <article
      aria-labelledby={headingId}
      aria-selected={isSelected}
      className={cn(
        'group rounded-2xl border p-4 transition focus-within:ring-2 focus-within:ring-primary-500',
        isSelected
          ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/20'
          : 'border-gray-200 bg-white hover:border-primary-300 hover:shadow-sm dark:border-gray-800 dark:bg-gray-950/50 dark:hover:border-primary-800',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className="block w-full rounded-lg text-left focus:outline-none"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {isPrimary && !isSelected && (
                <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-700 ring-1 ring-primary-200 dark:bg-primary-950/40 dark:text-primary-200 dark:ring-primary-900/60">
                  Sugerida
                </span>
              )}
              {isSelected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  <CheckCircleIcon className="h-3 w-3" /> Seleccionada
                </span>
              )}
              <h4 id={headingId} className="truncate text-sm font-bold text-gray-900 dark:text-white">
                {candidate.template.name}
              </h4>
            </div>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {candidate.template.type} · {candidate.template.representation} · {candidate.template.architecturalView}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200 dark:bg-gray-900 dark:text-emerald-300 dark:ring-emerald-900">
            {confidencePct}% confianza
          </span>
        </div>
        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">{candidate.rationale}</p>
        <p className="mt-2 text-xs font-semibold text-gray-700 dark:text-gray-300">
          Salida esperada: <span className="font-normal text-gray-600 dark:text-gray-400">{candidate.expectedOutput}</span>
        </p>
      </button>

      <CollapsibleSection label="Ver análisis detallado" openLabel="Ocultar análisis detallado" tone="primary" className="mt-2">
        <div className="space-y-3 rounded-xl bg-gray-50 p-3 text-xs dark:bg-gray-900/60">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Score determinístico</p>
            <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-gray-700 dark:text-gray-300">
              {SCORE_LABELS.map(({ key, label }) => {
                const raw = candidate.scoreBreakdown[key];
                if (typeof raw !== 'number') return null;
                return (
                  <li key={key} className="flex items-baseline justify-between gap-2">
                    <span>{label}</span>
                    <span className="font-mono text-[11px] font-semibold">{raw.toFixed(0)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          {candidate.tradeoffs.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Alternativas y trade-offs</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-gray-700 dark:text-gray-300">
                {candidate.tradeoffs.map(item => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
          {candidate.risks.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">Riesgos y advertencias</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-amber-900 dark:text-amber-200">
                {candidate.risks.map(item => <li key={item}>{item}</li>)}
              </ul>
            </div>
          )}
          {candidate.matchedCatalogTemplateName && (
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              Catálogo base: <span className="font-semibold text-gray-700 dark:text-gray-200">{candidate.matchedCatalogTemplateName}</span>
            </p>
          )}
        </div>
      </CollapsibleSection>
    </article>
  );
};

export default RecommendationCard;

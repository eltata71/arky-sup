import React from 'react';
import { tierLabel, type ArtifactQualityScore } from '../../../services/quality/artifactQualityModel';

export interface ArtifactQualityBadgeProps {
  score: ArtifactQualityScore;
  onClick?: () => void;
  compact?: boolean;
}

const TIER_CLASSES: Record<string, string> = {
  'world-class': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  'professional': 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  'acceptable': 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  'risky': 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  'blocked': 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

/**
 * Compact, glanceable score badge that wraps the unified artifact quality
 * score. Clicking the badge opens the full ArtifactQualityPanel.
 */
export const ArtifactQualityBadge: React.FC<ArtifactQualityBadgeProps> = ({ score, onClick, compact }) => {
  const cls = TIER_CLASSES[score.tier];
  const label = tierLabel(score.tier);
  const content = compact
    ? `${score.value}/100`
    : `Calidad ${score.value}/100 · ${label}`;
  if (!onClick) {
    return (
      <span className={`inline-flex items-center px-3 py-1.5 rounded-xl text-xs font-semibold ${cls}`}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-90 ${cls}`}
      title="Ver reporte de calidad del artefacto"
    >
      {content}
    </button>
  );
};

export default ArtifactQualityBadge;

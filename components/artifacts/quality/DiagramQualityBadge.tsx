import { useUiTranslation } from '../../../lib/i18n/UiTranslationContext';
import React from 'react';

export interface DiagramQualityBadgeProps {
  score: number;
  onClick: () => void;
}

/**
 * Quick-glance badge that gates the diagram quality panel. The level labels
 * describe the diagram itself ("not ready for presentation") so the signal
 * stays scoped to the artifact and isn't confused with a project criticality
 * flag.
 */
export const DiagramQualityBadge: React.FC<DiagramQualityBadgeProps> = ({ score, onClick }) => {
  const t = useUiTranslation();
  const level =
    score >= 90 ? { label: t("World Class"), cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' } :
    score >= 80 ? { label: t("Sólido"), cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' } :
    score >= 70 ? { label: t("Mejorable"), cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' } :
    { label: t("No listo para presentación"), cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' };

  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${level.cls}`}
      title={t("ui.ver-calidad-del-diagrama.d6b2f3")}
    >
      {t("ui.score.489f48")} {score}/100 · {level.label}
    </button>
  );
};

export default DiagramQualityBadge;

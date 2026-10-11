import React from 'react';
import { Card, SectionHeader, StatusBars, type StatusBarRow } from '../ui';
import { ARTIFACT_LIFECYCLE_STAGES, type ArtifactLifecycleCounts, type ArtifactLifecycleStage } from '../../lib/artifacts/artifactLifecycle';
import { useUiText } from '../../hooks/useUiText';

const STAGE_INK: Record<ArtifactLifecycleStage, { surface: string; ink: string }> = {
  draft: { surface: 'bg-gray-400', ink: 'text-gray-600 dark:text-gray-300' },
  'in-review': { surface: 'bg-sky-500', ink: 'text-sky-700 dark:text-sky-300' },
  'changes-requested': { surface: 'bg-amber-500', ink: 'text-amber-700 dark:text-amber-300' },
  rejected: { surface: 'bg-red-500', ink: 'text-red-700 dark:text-red-300' },
  approved: { surface: 'bg-emerald-500', ink: 'text-emerald-700 dark:text-emerald-300' },
  published: { surface: 'bg-primary-600', ink: 'text-primary-700 dark:text-primary-300' },
};

export interface ArtifactLifecyclePanelProps {
  counts: ArtifactLifecycleCounts;
  className?: string;
}

/**
 * Where the portfolio's artifacts stand in their cycle (14.0), with the same
 * stage names the canvas and the hub show. What cannot be measured from the
 * portfolio is said, with its count, instead of being painted as «borrador».
 */
export const ArtifactLifecyclePanel: React.FC<ArtifactLifecyclePanelProps> = ({ counts, className }) => {
  const t = useUiText();
  const rows: StatusBarRow[] = ARTIFACT_LIFECYCLE_STAGES.map((stage) => ({
    id: stage,
    label: t(`lifecycle.stage.${stage}`),
    value: counts.byStage[stage],
    ...STAGE_INK[stage],
  }));
  return (
    <Card className={`space-y-3 ${className ?? ''}`}>
      <SectionHeader as="h2" title={t('lifecycle.panelTitle')} description={t('lifecycle.panelHint')} compact />
      <StatusBars rows={rows} title={t('lifecycle.barsLabel')} emptyMessage={counts.unmeasured > 0 ? undefined : t('lifecycle.panelEmpty')} />
      {counts.unmeasured > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400">{t('lifecycle.unmeasured', { count: String(counts.unmeasured) })}</p>
      )}
    </Card>
  );
};

export default ArtifactLifecyclePanel;

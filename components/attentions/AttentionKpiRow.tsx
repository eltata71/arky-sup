/**
 * The five numbers a portfolio owner asks about architecture attentions.
 *
 * Same five-tile shape, same reading order and the same validated tones as the
 * initiative row one level up, because the two screens are read by the same
 * person minutes apart: making them differ would cost a relearn for nothing.
 *
 * Where the data does not exist the tile says so instead of showing a zero — an
 * attention with no planned work is not "100 % complete".
 */

import React from 'react';
import { StatTile } from '../ui';
import { useAppContext } from '../../context/AppContext';
import { AlertTriangle, Boxes, FileStack, Gavel, Layers } from 'lucide-react';
import { formatPercent } from '../architectureOffice/officeChartTokens';
import type { OfficePortfolio } from '../../services/architectureOffice';

export interface AttentionKpiRowProps {
  portfolio: OfficePortfolio;
  /** Attentions that answer no initiative — real work with no stated reason. */
  unlinkedCount: number;
  /** Distinct initiatives these attentions serve. */
  servedInitiatives: number;
  onFocusUnlinked?: () => void;
  onFocusDecisions?: () => void;
  className?: string;
}

export const AttentionKpiRow: React.FC<AttentionKpiRowProps> = ({
  portfolio,
  unlinkedCount,
  servedInitiatives,
  onFocusUnlinked,
  onFocusDecisions,
  className,
}) => {
  const { t } = useAppContext();
  const { rollup, projects, decisionQueue } = portfolio;
  const artifacts = projects.reduce((sum, project) => sum + project.artifactCount, 0);
  // An attention with nothing planned has no progress to report. The rollup
  // ratio is 1 for an empty set by definition, which would read as "todo listo".
  const progress = rollup.tasksTotal === 0 ? null : rollup.completionRatio;

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label={t('attKpi.projects')}
          value={projects.length}
          icon={Boxes}
          tone="primary"
          hint={servedInitiatives > 0
            ? t('attKpi.servedHint', { count: String(servedInitiatives) })
            : t('attKpi.noneServed')}
        />
        <StatTile
          label={t('attKpi.unlinked')}
          value={unlinkedCount}
          icon={AlertTriangle}
          tone={unlinkedCount > 0 ? 'danger' : 'success'}
          hint={unlinkedCount > 0
            ? t('attKpi.unlinkedHint')
            : t('attKpi.allLinked')}
          onClick={unlinkedCount > 0 ? onFocusUnlinked : undefined}
        />
        <StatTile
          label={t('officeKpi.deliverables')}
          value={rollup.engagements}
          icon={Layers}
          tone="neutral"
          hint={t('attKpi.deliverablesHint', { running: String(rollup.statusMix.running), blocked: String(rollup.statusMix.blocked) })}
        />
        <StatTile
          label={t('kpi.needDecision')}
          value={decisionQueue.length}
          icon={Gavel}
          tone={decisionQueue.length > 0 ? 'warning' : 'success'}
          hint={decisionQueue.length > 0
            ? t('attKpi.awaitingSignature')
            : t('attKpi.noSignature')}
          onClick={decisionQueue.length > 0 ? onFocusDecisions : undefined}
        />
        <StatTile
          label={t('kpi.taskProgress')}
          value={progress === null ? t('attKpi.noPlan') : formatPercent(progress)}
          icon={FileStack}
          tone="success"
          meter={progress ?? undefined}
          hint={progress === null
            ? t('attKpi.noPlanHint', { artifacts: String(artifacts) })
            : t('kpi.tasksHint', { done: String(rollup.tasksCompleted), total: String(rollup.tasksTotal), artifacts: String(artifacts) })}
        />
      </div>
    </div>
  );
};

export default AttentionKpiRow;

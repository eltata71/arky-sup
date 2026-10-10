/**
 * The five numbers a portfolio owner asks about business initiatives.
 *
 * Where the data does not exist the tile says so rather than showing a zero:
 * "sin indicadores medibles" is information, "0 %" is a lie about performance.
 */

import React from 'react';
import { StatTile } from '../ui';
import { useAppContext } from '../../context/AppContext';
import { AlertTriangle, CalendarClock, Gavel, Landmark, TrendingUp } from 'lucide-react';
import { formatPercent } from '../architectureOffice/officeChartTokens';
import { formatInvestment } from './initiativeUiLabels';
import type { InitiativePortfolioRollup } from '../../services/businessInitiatives/domain';

export interface InitiativeKpiRowProps {
  rollup: InitiativePortfolioRollup;
  /** Architecture attentions serving these initiatives. */
  attentionCount: number;
  currency?: string;
  onFocusDecisions?: () => void;
  className?: string;
}

export const InitiativeKpiRow: React.FC<InitiativeKpiRowProps> = ({
  rollup,
  attentionCount,
  currency,
  onFocusDecisions,
  className,
}) => {
  const { t } = useAppContext();
  const atRisk = rollup.healthMix['at-risk'];
  const milestoneRatio = rollup.milestonesTotal === 0
    ? null
    : rollup.milestonesMet / rollup.milestonesTotal;

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label={t('iniKpi.initiatives')}
          value={rollup.total}
          icon={Landmark}
          tone="primary"
          hint={t('iniKpi.servedHint', { count: String(attentionCount) })}
        />
        <StatTile
          label={t('iniKpi.atRisk')}
          value={atRisk}
          icon={AlertTriangle}
          tone={atRisk > 0 ? 'danger' : 'success'}
          hint={atRisk > 0
            ? t('iniKpi.atRiskHint', { overdue: String(rollup.overdue), missed: String(rollup.milestonesMissed) })
            : t('iniKpi.noneAtRisk')}
        />
        <StatTile
          label={t('kpi.needDecision')}
          value={rollup.awaitingDecision}
          icon={Gavel}
          tone={rollup.awaitingDecision > 0 ? 'warning' : 'success'}
          hint={rollup.awaitingDecision > 0
            ? t('iniKpi.awaitingApproval')
            : t('iniKpi.noApproval')}
          onClick={onFocusDecisions}
        />
        <StatTile
          label={t('iniKpi.milestonesMet')}
          value={milestoneRatio === null ? t('iniKpi.noMilestones') : formatPercent(milestoneRatio)}
          icon={CalendarClock}
          tone="neutral"
          meter={milestoneRatio ?? undefined}
          hint={milestoneRatio === null
            ? t('iniKpi.noMilestonesHint')
            : t('iniKpi.milestonesHint', { met: String(rollup.milestonesMet), total: String(rollup.milestonesTotal), due: String(rollup.dueSoon) })}
        />
        <StatTile
          label={t('iniKpi.indicators')}
          value={rollup.kpiAttainment === null ? t('iniKpi.unmeasured') : formatPercent(rollup.kpiAttainment)}
          icon={TrendingUp}
          tone="success"
          meter={rollup.kpiAttainment ?? undefined}
          hint={rollup.kpiAttainment === null
            ? t('iniKpi.unmeasuredHint', { count: String(rollup.kpisTotal) })
            : t('iniKpi.measurableHint', { measurable: String(rollup.kpisMeasurable), total: String(rollup.kpisTotal), investment: formatInvestment(rollup.investment || undefined, currency) })}
        />
      </div>
    </div>
  );
};

export default InitiativeKpiRow;

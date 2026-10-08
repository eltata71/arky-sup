/**
 * The five numbers the office is judged on, above everything else on the page.
 *
 * Each one is a stat tile rather than a chart, because each one *is* a single
 * number; the meters underneath give the ratio a shape without pretending to be
 * a time series.
 */

import React from 'react';
import { StatTile } from '../../ui';
import { useAppContext } from '../../../context/AppContext';
import { AlertOctagon, Briefcase, Gavel, Layers, Sparkles } from 'lucide-react';
import { formatPercent } from '../officeChartTokens';
import {
  totalFindings,
  type OfficePortfolioRollup,
} from '../../../services/architectureOffice/domain/officePortfolio';

export interface OfficeKpiRowProps {
  rollup: OfficePortfolioRollup;
  /** Architecture projects in the portfolio — the denominator for "entregables". */
  projectCount: number;
  /** Jumps to the decision queue. */
  onFocusDecisions?: () => void;
  className?: string;
}

export const OfficeKpiRow: React.FC<OfficeKpiRowProps> = ({
  rollup,
  projectCount,
  onFocusDecisions,
  className,
}) => {
  const { t } = useAppContext();
  const findings = totalFindings(rollup.findings);
  const blocking = rollup.findings.critical + rollup.findings.high;
  const budgetRatio = rollup.aiCallsBudget === 0 ? 0 : rollup.aiCallsUsed / rollup.aiCallsBudget;

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label={t('officeKpi.deliverables')}
          value={rollup.engagements}
          icon={Briefcase}
          tone="primary"
          hint={t('officeKpi.deliverablesHint', { count: String(projectCount) })}
        />
        <StatTile
          label={t('kpi.needDecision')}
          value={rollup.awaitingDecision + rollup.statusMix.blocked}
          icon={Gavel}
          tone={rollup.statusMix.blocked > 0 ? 'danger' : rollup.awaitingDecision > 0 ? 'warning' : 'success'}
          hint={rollup.statusMix.blocked > 0
            ? t('officeKpi.blockedHint', { count: String(rollup.statusMix.blocked) })
            : t('officeKpi.nobodyWaiting')}
          onClick={onFocusDecisions}
        />
        <StatTile
          label={t('kpi.taskProgress')}
          value={formatPercent(rollup.completionRatio)}
          icon={Layers}
          tone="success"
          meter={rollup.completionRatio}
          hint={t('kpi.tasksHint', { done: String(rollup.tasksCompleted), total: String(rollup.tasksTotal), artifacts: String(rollup.artifactsProduced) })}
        />
        <StatTile
          label={t('officeKpi.findings')}
          value={findings}
          icon={AlertOctagon}
          tone={blocking > 0 ? 'danger' : findings > 0 ? 'warning' : 'success'}
          hint={blocking > 0
            ? t('officeKpi.blockingHint', { count: String(blocking) })
            : t('officeKpi.noHighFindings')}
        />
        <StatTile
          label={t('officeKpi.aiUsage')}
          value={`${rollup.aiCallsUsed}/${rollup.aiCallsBudget}`}
          icon={Sparkles}
          tone="ai"
          meter={budgetRatio}
          hint={t('officeKpi.aiHint', { percent: formatPercent(budgetRatio) })}
        />
      </div>
    </div>
  );
};

export default OfficeKpiRow;

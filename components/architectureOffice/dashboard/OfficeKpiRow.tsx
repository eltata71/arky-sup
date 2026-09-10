/**
 * The five numbers the office is judged on, above everything else on the page.
 *
 * Each one is a stat tile rather than a chart, because each one *is* a single
 * number; the meters underneath give the ratio a shape without pretending to be
 * a time series.
 */

import React from 'react';
import { StatTile } from '../../ui';
import { AlertOctagon, Briefcase, Gavel, Layers, Sparkles } from 'lucide-react';
import { formatPercent } from '../officeChartTokens';
import {
  totalFindings,
  type OfficePortfolioRollup,
} from '../../../services/architectureOffice/officePortfolio';

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
  const findings = totalFindings(rollup.findings);
  const blocking = rollup.findings.critical + rollup.findings.high;
  const budgetRatio = rollup.aiCallsBudget === 0 ? 0 : rollup.aiCallsUsed / rollup.aiCallsBudget;

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Entregables"
          value={rollup.engagements}
          icon={Briefcase}
          tone="primary"
          hint={`En ${projectCount} proyecto(s) de arquitectura`}
        />
        <StatTile
          label="Requieren decisión"
          value={rollup.awaitingDecision + rollup.statusMix.blocked}
          icon={Gavel}
          tone={rollup.statusMix.blocked > 0 ? 'danger' : rollup.awaitingDecision > 0 ? 'warning' : 'success'}
          hint={rollup.statusMix.blocked > 0
            ? `${rollup.statusMix.blocked} bloqueado(s)`
            : 'Nada esperando por una persona'}
          onClick={onFocusDecisions}
        />
        <StatTile
          label="Avance de tareas"
          value={formatPercent(rollup.completionRatio)}
          icon={Layers}
          tone="success"
          meter={rollup.completionRatio}
          hint={`${rollup.tasksCompleted}/${rollup.tasksTotal} tareas · ${rollup.artifactsProduced} artefacto(s)`}
        />
        <StatTile
          label="Hallazgos abiertos"
          value={findings}
          icon={AlertOctagon}
          tone={blocking > 0 ? 'danger' : findings > 0 ? 'warning' : 'success'}
          hint={blocking > 0
            ? `${blocking} crítico(s) o alto(s)`
            : 'Sin hallazgos de severidad alta'}
        />
        <StatTile
          label="Consumo de IA"
          value={`${rollup.aiCallsUsed}/${rollup.aiCallsBudget}`}
          icon={Sparkles}
          tone="ai"
          meter={budgetRatio}
          hint={`Presupuesto de llamadas · ${formatPercent(budgetRatio)} usado`}
        />
      </div>
    </div>
  );
};

export default OfficeKpiRow;

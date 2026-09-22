/**
 * The five numbers a portfolio owner asks about business initiatives.
 *
 * Where the data does not exist the tile says so rather than showing a zero:
 * "sin indicadores medibles" is information, "0 %" is a lie about performance.
 */

import React from 'react';
import { StatTile } from '../ui';
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
  const atRisk = rollup.healthMix['at-risk'];
  const milestoneRatio = rollup.milestonesTotal === 0
    ? null
    : rollup.milestonesMet / rollup.milestonesTotal;

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Iniciativas"
          value={rollup.total}
          icon={Landmark}
          tone="primary"
          hint={`Atendidas por ${attentionCount} proyecto(s) de arquitectura`}
        />
        <StatTile
          label="En riesgo"
          value={atRisk}
          icon={AlertTriangle}
          tone={atRisk > 0 ? 'danger' : 'success'}
          hint={atRisk > 0
            ? `${rollup.overdue} vencida(s) · ${rollup.milestonesMissed} hito(s) incumplido(s)`
            : 'Ninguna vencida ni con riesgo crítico'}
        />
        <StatTile
          label="Requieren decisión"
          value={rollup.awaitingDecision}
          icon={Gavel}
          tone={rollup.awaitingDecision > 0 ? 'warning' : 'success'}
          hint={rollup.awaitingDecision > 0
            ? 'Esperan aprobación del negocio'
            : 'Nada esperando aprobación'}
          onClick={onFocusDecisions}
        />
        <StatTile
          label="Hitos cumplidos"
          value={milestoneRatio === null ? 'Sin hitos' : formatPercent(milestoneRatio)}
          icon={CalendarClock}
          tone="neutral"
          meter={milestoneRatio ?? undefined}
          hint={milestoneRatio === null
            ? 'Ninguna iniciativa declara hitos todavía'
            : `${rollup.milestonesMet}/${rollup.milestonesTotal} · ${rollup.dueSoon} vence(n) en 30 días`}
        />
        <StatTile
          label="Avance de indicadores"
          value={rollup.kpiAttainment === null ? 'Sin medir' : formatPercent(rollup.kpiAttainment)}
          icon={TrendingUp}
          tone="success"
          meter={rollup.kpiAttainment ?? undefined}
          hint={rollup.kpiAttainment === null
            ? `${rollup.kpisTotal} KPI declarado(s), ninguno con línea base y meta`
            : `${rollup.kpisMeasurable}/${rollup.kpisTotal} KPI medibles · ${formatInvestment(rollup.investment || undefined, currency)}`}
        />
      </div>
    </div>
  );
};

export default InitiativeKpiRow;

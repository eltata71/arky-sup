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
import { AlertTriangle, Boxes, FileStack, Gavel, Layers } from 'lucide-react';
import { formatPercent } from '../architectureOffice/officeChartTokens';
import type { OfficePortfolio } from '../../services/architectureOffice/officePortfolio';

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
  const { rollup, projects, decisionQueue } = portfolio;
  const artifacts = projects.reduce((sum, project) => sum + project.artifactCount, 0);
  // An attention with nothing planned has no progress to report. The rollup
  // ratio is 1 for an empty set by definition, which would read as "todo listo".
  const progress = rollup.tasksTotal === 0 ? null : rollup.completionRatio;

  return (
    <div className={className}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Proyectos"
          value={projects.length}
          icon={Boxes}
          tone="primary"
          hint={servedInitiatives > 0
            ? `Responden a ${servedInitiatives} iniciativa(s) de negocio`
            : 'Ninguno declara todavía la iniciativa que atiende'}
        />
        <StatTile
          label="Sin iniciativa"
          value={unlinkedCount}
          icon={AlertTriangle}
          tone={unlinkedCount > 0 ? 'danger' : 'success'}
          hint={unlinkedCount > 0
            ? 'Trabajo de arquitectura sin necesidad de negocio declarada'
            : 'Todo proyecto declara la necesidad que responde'}
          onClick={unlinkedCount > 0 ? onFocusUnlinked : undefined}
        />
        <StatTile
          label="Entregables"
          value={rollup.engagements}
          icon={Layers}
          tone="neutral"
          hint={`${rollup.statusMix.running} en curso · ${rollup.statusMix.blocked} bloqueado(s)`}
        />
        <StatTile
          label="Requieren decisión"
          value={decisionQueue.length}
          icon={Gavel}
          tone={decisionQueue.length > 0 ? 'warning' : 'success'}
          hint={decisionQueue.length > 0
            ? 'Esperan una firma en la Oficina de Arquitectura'
            : 'Nada esperando una firma'}
          onClick={decisionQueue.length > 0 ? onFocusDecisions : undefined}
        />
        <StatTile
          label="Avance de tareas"
          value={progress === null ? 'Sin plan' : formatPercent(progress)}
          icon={FileStack}
          tone="success"
          meter={progress ?? undefined}
          hint={progress === null
            ? `${artifacts} artefacto(s) · ningún entregable con tareas planificadas`
            : `${rollup.tasksCompleted}/${rollup.tasksTotal} tareas · ${artifacts} artefacto(s)`}
        />
      </div>
    </div>
  );
};

export default AttentionKpiRow;

/**
 * Cómo va la iniciativa según lo que están haciendo sus proyectos.
 *
 * Antes esta zona era una lista de enlaces: los proyectos que citan el código
 * de la iniciativa, con su líder y su fecha. Eso responde «¿qué hay colgando de
 * aquí?» y deja sin responder la pregunta por la que existe el nivel de arriba:
 * *¿cuánto de mi necesidad de negocio se ha movido, y qué la está frenando?*
 *
 * El panel contesta en tres planos, y el orden es deliberado:
 *
 *  1. **El agregado** —avance ponderado, proyectos fuera de rumbo, riesgos
 *     severos heredados—, que es lo que se mira en una reunión de seguimiento.
 *  2. **Los huecos**: resultados esperados que ningún proyecto declara servir,
 *     indicadores que nadie mueve y referencias rotas. Es el hallazgo más útil
 *     del panel: trabajo que el negocio espera y que nadie ha empezado, o
 *     enlaces que hay que arreglar. Nada de esto se oculta.
 *  3. **Los proyectos**, uno a uno, con lo que cada uno declara aportar.
 *
 * Nada se calcula aquí: `useInitiativeDelivery` compone el dominio y esta
 * pantalla sólo lo pinta. Un porcentaje calculado dentro de un JSX es una regla
 * de negocio que no se puede probar sin renderizar.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, StatTile, cn } from '../ui';
import { ArrowRight, Boxes, Plus } from 'lucide-react';
import { EmptyRow, SectionCard } from './panelPrimitives';
import { INITIATIVE_SECTION_ICONS, formatDate } from './initiativeUiLabels';
import {
  ATTENTION_HEALTH_HINTS,
  ATTENTION_HEALTH_LABELS,
  ATTENTION_HEALTH_TONES,
  CONTRIBUTION_STATE_LABELS,
} from '../attentions/attentionUiLabels';
import { useInitiativeDelivery } from '../../hooks/useInitiativeDelivery';
import { EA_LEVELS } from '../../lib/eaTerminology';
import type { BusinessInitiative } from '../../services/businessInitiatives';
import type { AttentionDeliveryReport } from '../../services/architectureProjects';
import type { Project } from '../../context/AppContext';

export interface InitiativeDeliveryPanelProps {
  initiative: BusinessInitiative;
  /** Todas las iniciativas: hacen falta para resolver un enlace por código. */
  initiatives: readonly BusinessInitiative[];
  projects: readonly Project[];
  id?: string;
}

const percent = (value: number | null): string =>
  (value === null ? '—' : `${Math.round(value * 100)} %`);

/** Una fila de proyecto: cómo va y qué declara mover en esta iniciativa. */
const AttentionRow: React.FC<{
  report: AttentionDeliveryReport;
  initiative: BusinessInitiative;
  onOpen: () => void;
}> = ({ report, initiative, onOpen }) => {
  const outcomeById = new Map(initiative.expectedOutcomes.map((entry) => [entry.id, entry]));
  const kpiById = new Map(initiative.kpis.map((entry) => [entry.id, entry]));

  return (
    <li className="rounded-lg border border-gray-200 dark:border-gray-800">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-primary-950/30"
      >
        <Boxes className="h-4 w-4 shrink-0 text-primary-500" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900 dark:text-gray-100">
            {report.name}
          </span>
          <span className="text-2xs text-gray-500 dark:text-gray-400">
            {report.architectureLead ?? 'Sin líder asignado'}
            {report.targetEndDate && ` · ${formatDate(report.targetEndDate)}`}
            {report.progress !== null && ` · ${percent(report.progress)}`}
            {report.progressSource === 'milestones' && ' (deducido de los hitos)'}
          </span>
        </span>
        <Badge tone={ATTENTION_HEALTH_TONES[report.health]} size="xs">
          {ATTENTION_HEALTH_LABELS[report.health]}
        </Badge>
        <ArrowRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-700" aria-hidden />
      </button>

      {report.contributions.length > 0 && (
        <ul className="space-y-1 border-t border-gray-100 px-2.5 py-2 dark:border-gray-800">
          {report.contributions.map((contribution) => {
            const outcome = contribution.outcomeId ? outcomeById.get(contribution.outcomeId) : undefined;
            const kpi = contribution.kpiId ? kpiById.get(contribution.kpiId) : undefined;
            return (
              <li key={contribution.id} className="flex items-start gap-2">
                <span
                  className={cn(
                    'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                    contribution.state === 'blocked' ? 'bg-red-500' : 'bg-primary-400',
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs leading-relaxed text-gray-700 dark:text-gray-200">
                    {contribution.statement}
                  </span>
                  <span className="text-2xs text-gray-500 dark:text-gray-400">
                    {CONTRIBUTION_STATE_LABELS[contribution.state]}
                    {outcome && ` · Resultado: ${outcome.statement}`}
                    {kpi && ` · Indicador: ${kpi.name}`}
                    {contribution.weight ? ` · Peso ${contribution.weight}` : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
};

export const InitiativeDeliveryPanel: React.FC<InitiativeDeliveryPanelProps> = ({
  initiative,
  initiatives,
  projects,
  id,
}) => {
  const navigate = useNavigate();
  const { reports, rollup } = useInitiativeDelivery(initiative, initiatives, projects);

  const uncoveredOutcomes = initiative.expectedOutcomes
    .filter((outcome) => rollup.uncoveredOutcomeIds.includes(outcome.id));
  const uncoveredKpis = initiative.kpis.filter((kpi) => rollup.uncoveredKpiIds.includes(kpi.id));

  return (
    <SectionCard
      id={id}
      icon={INITIATIVE_SECTION_ICONS.attentions}
      title={EA_LEVELS.engagementProject.plural}
      hint="La arquitectura que responde a esta iniciativa, y lo que mueve en ella."
      count={rollup.total}
    >
      {rollup.total === 0 ? (
        <div className="space-y-2">
          <EmptyRow>
            Ningún proyecto de arquitectura responde todavía a {initiative.code || 'esta iniciativa'}.
            Ábrelo desde aquí y el asistente arrancará con el contexto de esta iniciativa.
          </EmptyRow>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate(`/projects?iniciativa=${initiative.id}&crear=guiado`)}
            >
              <Plus className="mr-1.5 h-4 w-4" aria-hidden />
              Nuevo proyecto de arquitectura
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/office')}>
              <Plus className="mr-1 h-3.5 w-3.5" aria-hidden />
              Abrir un entregable en la Oficina
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatTile
              label="Avance de la entrega"
              value={percent(rollup.progress)}
              hint={rollup.progress === null
                ? 'Ningún proyecto declara avance todavía'
                : (rollup.weighting === 'declared'
                  ? `Ponderado por los pesos declarados (${rollup.declaredWeight})`
                  : 'Todos los proyectos pesan igual: nadie ha declarado pesos')}
            />
            <StatTile
              label="Proyectos midiendo"
              value={`${rollup.measured}/${rollup.total}`}
              hint="Con avance declarado o deducible de sus hitos"
              tone={rollup.measured === 0 && rollup.total > 0 ? 'warning' : undefined}
            />
            <StatTile
              label="Fuera de rumbo"
              value={String(rollup.offTrack)}
              hint={ATTENTION_HEALTH_HINTS['off-track']}
              tone={rollup.offTrack > 0 ? 'danger' : undefined}
            />
            <StatTile
              label="Riesgos severos heredados"
              value={String(rollup.inheritedSevereRisks)}
              hint="Altos y críticos que sus proyectos han registrado"
              tone={rollup.inheritedSevereRisks > 0 ? 'warning' : undefined}
            />
          </div>

          {uncoveredOutcomes.length > 0 && (
            <Alert tone="warning">
              <span className="font-semibold">
                {uncoveredOutcomes.length} resultado(s) esperado(s) sin proyecto que los sirva:
              </span>{' '}
              {uncoveredOutcomes.map((outcome) => outcome.statement).join(' · ')}
            </Alert>
          )}

          {uncoveredKpis.length > 0 && (
            <Alert tone="info">
              <span className="font-semibold">{uncoveredKpis.length} indicador(es) que ningún proyecto declara mover:</span>{' '}
              {uncoveredKpis.map((kpi) => kpi.name).join(' · ')}
            </Alert>
          )}

          {rollup.blocked.length > 0 && (
            <Alert tone="danger">
              {rollup.blocked.length} aporte(s) bloqueado(s):{' '}
              {rollup.blocked.map((entry) => entry.contribution.statement).join(' · ')}
            </Alert>
          )}

          {/* Una referencia rota se reporta, nunca se descarta: es un enlace que
              hay que arreglar, no una fila que deba desaparecer del informe. */}
          {rollup.danglingReferences.length > 0 && (
            <Alert tone="warning">
              {rollup.danglingReferences.length} aporte(s) citan un resultado o un indicador que ya no
              existe en esta iniciativa. Ábrelos en su proyecto y vuelve a elegirlo.
            </Alert>
          )}

          <ul className="space-y-1.5">
            {reports.map((report) => (
              <AttentionRow
                key={report.projectId}
                report={report}
                initiative={initiative}
                onOpen={() => navigate(`/workspace/${report.projectId}`)}
              />
            ))}
          </ul>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(`/projects?iniciativa=${initiative.id}&crear=guiado`)}
          >
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Nuevo proyecto de arquitectura
          </Button>
        </>
      )}
    </SectionCard>
  );
};

export default InitiativeDeliveryPanel;

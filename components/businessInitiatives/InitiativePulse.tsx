/**
 * The shape of the initiative portfolio: what state it is in, how it is spread
 * across the roadmap horizons, and where the risk sits.
 *
 * Three forms, three questions. The horizon bars are ranked rather than a
 * timeline because "now / next / later" is an ordering, not a set of dates —
 * drawing it on a time axis would invent precision the planners did not give.
 */

import React, { useMemo } from 'react';
import { Card, CardTitle, DonutChart, FlowBars, type FlowStage } from '../ui';
import { CalendarClock, CircleDot, Clock, Shield, ShieldAlert } from 'lucide-react';
import { OFFICE_HEALTH_VISUALS } from '../architectureOffice/officeChartTokens';
import {
  HORIZON_LABELS,
  INITIATIVE_HEALTH_LABELS,
  INITIATIVE_HEALTH_HINTS,
  initiativeHealthVisual,
  RISK_LEVEL_LABELS,
} from './initiativeUiLabels';
import {
  INITIATIVE_HEALTH_ORDER,
  initiativeHealth,
  type InitiativePortfolioRollup,
} from '../../services/businessInitiatives/initiativeMetrics';
import type {
  BusinessInitiative,
  InitiativeHorizon,
  InitiativeRiskLevel,
} from '../../services/businessInitiatives/BusinessInitiativeTypes';

export interface InitiativePulseProps {
  initiatives: BusinessInitiative[];
  rollup: InitiativePortfolioRollup;
  className?: string;
}

const HORIZON_ICONS: Record<InitiativeHorizon, typeof Clock> = {
  now: CircleDot,
  next: Clock,
  later: CalendarClock,
};

export const InitiativePulse: React.FC<InitiativePulseProps> = ({
  initiatives,
  rollup,
  className,
}) => {
  const healthSegments = useMemo(
    () => INITIATIVE_HEALTH_ORDER.map((health) => {
      const visual = initiativeHealthVisual(health);
      return {
        id: health,
        label: INITIATIVE_HEALTH_LABELS[health],
        value: rollup.healthMix[health],
        fill: visual.fill,
        stroke: visual.stroke,
        ink: visual.ink,
        surface: visual.surface,
        hint: INITIATIVE_HEALTH_HINTS[health],
      };
    }),
    [rollup.healthMix],
  );

  const horizonStages = useMemo<FlowStage[]>(() => {
    const counts: Record<InitiativeHorizon, number> = { now: 0, next: 0, later: 0 };
    for (const initiative of initiatives) counts[initiative.horizon] += 1;
    const tones = {
      now: OFFICE_HEALTH_VISUALS.running,
      next: OFFICE_HEALTH_VISUALS['awaiting-decision'],
      later: OFFICE_HEALTH_VISUALS.idle,
    } as const;
    return (Object.keys(HORIZON_LABELS) as InitiativeHorizon[]).map((horizon) => ({
      id: horizon,
      label: HORIZON_LABELS[horizon],
      value: counts[horizon],
      surface: tones[horizon].surface,
      ink: tones[horizon].ink,
      icon: HORIZON_ICONS[horizon],
    }));
  }, [initiatives]);

  const riskStages = useMemo<FlowStage[]>(() => {
    const order: InitiativeRiskLevel[] = ['critical', 'high', 'medium', 'low'];
    const tones = {
      critical: OFFICE_HEALTH_VISUALS.blocked,
      high: OFFICE_HEALTH_VISUALS.blocked,
      medium: OFFICE_HEALTH_VISUALS['awaiting-decision'],
      low: OFFICE_HEALTH_VISUALS.idle,
    } as const;
    return order.map((level) => ({
      id: level,
      label: RISK_LEVEL_LABELS[level],
      value: rollup.riskMix[level],
      surface: tones[level].surface,
      ink: tones[level].ink,
      icon: level === 'critical' || level === 'high' ? ShieldAlert : Shield,
    }));
  }, [rollup.riskMix]);

  const atRiskNames = useMemo(
    () => initiatives
      .filter((initiative) => initiativeHealth(initiative) === 'at-risk')
      .map((initiative) => initiative.title)
      .slice(0, 4),
    [initiatives],
  );

  return (
    <div className={className}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <div>
            <CardTitle>Estado del portafolio de iniciativas</CardTitle>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              El estado se deduce de las fechas y los riesgos, no solo de lo que alguien marcó.
            </p>
          </div>
          <DonutChart
            segments={healthSegments}
            centerLabel="Iniciativas"
            title="Iniciativas de negocio por estado"
            emptyMessage="Sin iniciativas registradas. La primera necesidad de negocio que captures aparecerá aquí."
          />
          {atRiskNames.length > 0 && (
            <div className="rounded-lg bg-red-50 px-3 py-2 dark:bg-red-950/30">
              <p className="text-2xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                En riesgo ahora
              </p>
              <ul className="mt-0.5 space-y-0.5">
                {atRiskNames.map((name) => (
                  <li key={name} className="truncate text-xs text-red-700 dark:text-red-300">{name}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="space-y-3">
            <div>
              <CardTitle>Horizonte de la hoja de ruta</CardTitle>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Cuándo espera el negocio que se atienda cada iniciativa.
              </p>
            </div>
            <FlowBars
              stages={horizonStages}
              title="Iniciativas por horizonte"
              emptyMessage="Ninguna iniciativa declara todavía su horizonte temporal."
            />
          </Card>

          <Card className="space-y-3">
            <div>
              <CardTitle>Exposición al riesgo</CardTitle>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                Nivel de riesgo declarado en cada iniciativa.
              </p>
            </div>
            <FlowBars
              stages={riskStages}
              title="Iniciativas por nivel de riesgo"
              emptyMessage="Ninguna iniciativa declara todavía riesgos."
            />
          </Card>
        </div>
      </div>
    </div>
  );
};

export default InitiativePulse;

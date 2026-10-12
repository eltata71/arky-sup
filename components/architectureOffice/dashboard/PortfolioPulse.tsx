import { useUiTranslation } from '../../../lib/i18n/UiTranslationContext';
/**
 * The pulse of the office: what state the portfolio is in, where the work is
 * piling up, and what has actually shipped over the last two weeks.
 *
 * Three forms, three jobs — a mix (donut), a ranked comparison (bars) and a
 * change over time (area). None of them repeats another's answer.
 */

import React, { useMemo } from 'react';
import { Card, CardTitle, DonutChart, FlowBars, TrendArea, type FlowStage } from '../../ui';
import {
  CheckCircle2,
  FileSearch,
  Hourglass,
  PlayCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { formatDayLabel, healthSegments, OFFICE_HEALTH_VISUALS } from '../officeChartTokens';
import type {
  OfficeActivityPoint,
  OfficePortfolioRollup,
} from '../../../services/architectureOffice';

export interface PortfolioPulseProps {
  rollup: OfficePortfolioRollup;
  activity: OfficeActivityPoint[];
  className?: string;
}

export const PortfolioPulse: React.FC<PortfolioPulseProps> = ({ rollup, activity, className }) => {
  const t = useUiTranslation();
  const segments = useMemo(() => healthSegments(rollup.statusMix), [rollup.statusMix]);

  const stages = useMemo<FlowStage[]>(() => {
    const pending = Math.max(
      0,
      rollup.tasksTotal - rollup.tasksCompleted - rollup.tasksFailed
        - rollup.tasksInFlight - rollup.tasksReworking,
    );
    return [
      {
        id: 'pending',
        label: t("En cola"),
        value: pending,
        surface: OFFICE_HEALTH_VISUALS.idle.surface,
        ink: OFFICE_HEALTH_VISUALS.idle.ink,
        icon: Hourglass,
      },
      {
        id: 'in-flight',
        label: t("En curso"),
        value: rollup.tasksInFlight,
        surface: OFFICE_HEALTH_VISUALS.running.surface,
        ink: OFFICE_HEALTH_VISUALS.running.ink,
        icon: PlayCircle,
      },
      {
        id: 'rework',
        label: t("Retrabajo"),
        value: rollup.tasksReworking,
        surface: OFFICE_HEALTH_VISUALS['awaiting-decision'].surface,
        ink: OFFICE_HEALTH_VISUALS['awaiting-decision'].ink,
        icon: RefreshCw,
      },
      {
        id: 'completed',
        label: t("Completadas"),
        value: rollup.tasksCompleted,
        surface: OFFICE_HEALTH_VISUALS.delivered.surface,
        ink: OFFICE_HEALTH_VISUALS.delivered.ink,
        icon: CheckCircle2,
      },
      {
        id: 'failed',
        label: t("Detenidas"),
        value: rollup.tasksFailed,
        surface: OFFICE_HEALTH_VISUALS.blocked.surface,
        ink: OFFICE_HEALTH_VISUALS.blocked.ink,
        icon: XCircle,
      },
    ];
  }, [rollup, t]);

  const trend = useMemo(
    () => activity.map((point) => ({
      label: formatDayLabel(point.date),
      value: point.tasksCompleted,
    })),
    [activity],
  );

  const delivered = activity.reduce((sum, point) => sum + point.engagementsDelivered, 0);
  const reworked = activity.reduce((sum, point) => sum + point.reviewsRequested, 0);

  return (
    <div className={className}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <div>
            <CardTitle>{t("ui.estado-del-portafolio.0415e9")}</CardTitle>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {t("ui.entregables-por-estado-en-to.2620b6")}
            </p>
          </div>
          <DonutChart
            segments={segments}
            centerLabel={t("Entregables")}
            title={t("ui.entregables-por-estado.e83907")}
            emptyMessage={t("Ningún entregable abierto todavía. Aparecerán aquí en cuanto la Oficina reciba el primero.")}
          />
        </Card>

        <Card className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle>{t("ui.flujo-de-trabajo.915319")}</CardTitle>
              <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                {t("ui.donde-esta-acumulandose-el-t.83e2bf")}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-2 py-1 text-2xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              <FileSearch className="h-3.5 w-3.5" aria-hidden />
              {rollup.tasksTotal} {t("ui.tareas.00fa30")}
            </span>
          </div>
          <FlowBars
            stages={stages}
            title={t("ui.tareas-por-etapa-del-flujo.e0d647")}
            emptyMessage={t("Sin tareas planificadas. El flujo se llena cuando se aprueba el charter de un entregable.")}
          />
        </Card>
      </div>

      <Card className="mt-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{t("ui.actividad-de-la-oficina.2466ae")}</CardTitle>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              {t("ui.tareas-completadas-por-dia-u.bff992")} {activity.length} {t("ui.dias.fe85bc")}
            </p>
          </div>
          <div className="flex gap-4 text-right">
            <div>
              <p className="text-lg font-bold leading-none tabular-nums text-gray-900 dark:text-gray-50">
                {delivered}
              </p>
              <p className="mt-0.5 text-2xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("ui.entregas.8786c0")}
              </p>
            </div>
            <div>
              <p className="text-lg font-bold leading-none tabular-nums text-gray-900 dark:text-gray-50">
                {reworked}
              </p>
              <p className="mt-0.5 text-2xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t("ui.retrabajos.43ebe5")}
              </p>
            </div>
          </div>
        </div>
        <TrendArea
          points={trend}
          title={t("ui.tareas-completadas-por-dia.fe9a4a")}
          unit="tareas"
          emptyMessage={t("Sin tareas completadas en los últimos días. La curva empieza con la primera ejecución.")}
        />
      </Card>
    </div>
  );
};

export default PortfolioPulse;

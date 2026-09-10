/**
 * El centro de riesgo y atención: todo lo que está mal, en un sitio, ordenado
 * por gravedad.
 *
 * Antes esta información existía y estaba repartida: los vínculos rotos en su
 * panel, los proyectos huérfanos dentro del texto de una tarjeta de KPI, los
 * hitos incumplidos sólo dentro de la iniciativa que los tenía, y los hallazgos
 * críticos únicamente en la sala del entregable. Cada dato era correcto y el
 * conjunto no se podía leer: nadie sabía cuál de los cuatro atender primero
 * porque nunca aparecían juntos.
 *
 * ## Tres decisiones que hacen que esto sea triaje y no una lista
 *
 * - **La gravedad ya viene decidida** por `buildPortfolioCommandCenter`. Esta
 *   pantalla no vuelve a juzgar si un hito incumplido es peor que un vínculo
 *   roto; si lo hiciera, habría dos criterios en el producto y ninguno sería el
 *   criterio.
 * - **Las barras se escalan contra la fila mayor, no contra la suma.** Estas
 *   cantidades no suman nada: tres hallazgos críticos y cuarenta tareas fuera
 *   de plazo no son 43 de nada. La comparación útil es «esta fila frente a la
 *   peor», que es la que hace quien tiene que empezar por algún sitio.
 * - **Nada se cuenta dos veces al leer.** Cada fila dice en una frase qué es lo
 *   que cuenta, porque «9» sin unidad manda al lector a buscarla.
 *
 * Cuando no hay nada que atender, lo dice y se aparta: un panel vacío con nueve
 * ceros ocupa el mismo espacio que uno lleno y enseña al lector a ignorarlo.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Card, SectionHeader, StatusBars, cn, type StatusBarRow, type StatusTone } from '../ui';
import { STATUS_VISUALS } from '../ui';
import { TYPE } from '../../lib/designTokens';
import type { PortfolioSignal } from '../../services/architectureOffice';

/** Cada gravedad, con el tono del sistema de diseño que le corresponde. */
const SEVERITY_TONE: Readonly<Record<PortfolioSignal['severity'], StatusTone>> = Object.freeze({
  critical: 'critical',
  risk: 'risk',
  warning: 'warning',
  info: 'info',
});

const DESTINATION_ROUTES: Readonly<Record<NonNullable<PortfolioSignal['destination']>, string>> = Object.freeze({
  initiatives: '/initiatives',
  projects: '/projects',
  office: '/office',
});

export interface AttentionCenterProps {
  signals: readonly PortfolioSignal[];
  /** Cuántas de ellas son críticas o de riesgo. Decide el tono de la cabecera. */
  urgentSignals: number;
  className?: string;
}

export const AttentionCenter: React.FC<AttentionCenterProps> = ({
  signals,
  urgentSignals,
  className,
}) => {
  const navigate = useNavigate();

  if (signals.length === 0) {
    return (
      <Card className={cn('flex items-center gap-3', className)}>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <CheckCircle2 className="h-5 w-5" aria-hidden strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <h2 className={TYPE.cardTitle}>Nada reclama atención</h2>
          <p className={cn(TYPE.metadata, 'mt-0.5')}>
            Ningún riesgo abierto, ningún vínculo roto y ningún elemento fuera de plazo en el portafolio.
          </p>
        </div>
      </Card>
    );
  }

  const rows: StatusBarRow[] = signals.map((signal) => {
    const visual = STATUS_VISUALS[SEVERITY_TONE[signal.severity]];
    return {
      id: signal.id,
      label: signal.label,
      value: signal.count,
      surface: visual.surface,
      ink: visual.ink,
      hint: signal.hint,
      onSelect: signal.destination
        ? () => navigate(DESTINATION_ROUTES[signal.destination as NonNullable<PortfolioSignal['destination']>])
        : undefined,
    };
  });

  return (
    <Card className={cn('space-y-3', className)}>
      <SectionHeader
        as="h2"
        title="Riesgo y atención"
        description={
          urgentSignals > 0
            ? `${urgentSignals} señal(es) de gravedad alta. Empieza por la barra más larga.`
            : 'Nada crítico abierto. Lo de abajo es seguimiento, no urgencia.'
        }
        icon={
          <span
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-xl',
              urgentSignals > 0
                ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300'
                : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
            )}
          >
            {urgentSignals > 0
              ? <AlertOctagon className="h-5 w-5" aria-hidden strokeWidth={2} />
              : <ShieldAlert className="h-5 w-5" aria-hidden strokeWidth={2} />}
          </span>
        }
        compact
      />
      <StatusBars rows={rows} title="Señales del portafolio, por gravedad" unit="elemento(s)" />
    </Card>
  );
};

export default AttentionCenter;

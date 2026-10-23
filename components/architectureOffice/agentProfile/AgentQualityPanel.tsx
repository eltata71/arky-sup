/**
 * Cómo trabaja cada agente, no sólo cómo es (plan de agentes 20.1).
 *
 * Las cifras las deriva `buildAgentQualityReport` de los encargos que el usuario
 * ya tiene; aquí sólo se redactan. Lo que no se mide se dice («sin medir») y
 * nunca se pinta como cero: un 0 % de aprobación a la primera es una acusación,
 * y «aún no hay tareas terminadas» es la verdad.
 *
 * Se carga en diferido desde `/agents`: la ruta vive a un kilobyte de su techo
 * y el panel sólo hace falta a quien baja a leerlo.
 */

import React, { useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { Card, SectionHeader, cn } from '../../ui';
import { StatusBars } from '../../ui/charts';
import { useUiTranslation } from '../../../lib/i18n/UiTranslationContext';
import { useOffice } from '../../../context/OfficeContext';
import { useAgentDisplayName } from '../../../hooks/useAgentDisplayName';
import {
  buildAgentQualityReport,
  type QualityWindowDays,
} from '../../../services/architectureOffice/agents'; // the cards' door, not the barrel (F6-05)

const WINDOWS: readonly QualityWindowDays[] = [7, 30];

const formatUsd = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;

export const AgentQualityPanel: React.FC = () => {
  const t = useUiTranslation();
  const { engagements } = useOffice();
  const nameOf = useAgentDisplayName();
  const [windowDays, setWindowDays] = useState<QualityWindowDays>(30);
  const report = useMemo(
    () => buildAgentQualityReport(engagements, windowDays, Date.now()),
    [engagements, windowDays],
  );
  const unmeasured = t('agentQuality.unmeasured');

  const approvalRows = report.rows
    .filter((row) => row.firstPassApprovalRate !== null)
    .map((row) => ({
      id: row.agentId,
      label: nameOf(row.agentId),
      value: Math.round((row.firstPassApprovalRate ?? 0) * 100),
      surface: 'bg-emerald-500',
      ink: 'text-emerald-700 dark:text-emerald-300',
    }));

  return (
    <Card className="space-y-3 p-4">
      <SectionHeader
        as="h2"
        title={t('agentQuality.title')}
        description={t('agentQuality.description')}
        compact
        actions={(
          <div className="flex gap-1" role="group" aria-label={t('agentQuality.window')}>
            {WINDOWS.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={windowDays === days}
                onClick={() => setWindowDays(days)}
                className={cn(
                  'min-h-9 rounded-lg px-3 text-xs font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  windowDays === days
                    ? 'bg-primary-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200',
                )}
              >
                {t('agentQuality.days', { p0: String(days) })}
              </button>
            ))}
          </div>
        )}
      />

      {report.rows.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-3 text-sm text-gray-600 dark:bg-gray-900/50 dark:text-gray-300" role="status">
          <Activity className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
          {t('agentQuality.empty', { p0: String(windowDays) })}
        </p>
      ) : (
        <>
          {approvalRows.length > 0 && (
            <StatusBars rows={approvalRows} title={t('agentQuality.approvalChart')} unit="%" />
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <caption className="sr-only">{t('agentQuality.caption', { p0: String(windowDays) })}</caption>
              <thead>
                <tr className="text-2xs uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">{t('agentQuality.col.agent')}</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">{t('agentQuality.col.tasks')}</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">{t('agentQuality.col.approval')}</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">{t('agentQuality.col.retries')}</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">{t('agentQuality.col.cost')}</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">{t('agentQuality.col.latency')}</th>
                  <th scope="col" className="py-1.5 font-semibold">{t('agentQuality.col.handoffs')}</th>
                </tr>
              </thead>
              <tbody className="text-gray-800 dark:text-gray-100">
                {report.rows.map((row) => (
                  <tr key={row.agentId} className="border-t border-gray-100 dark:border-gray-800">
                    <th scope="row" className="py-1.5 pr-3 font-medium">{nameOf(row.agentId)}</th>
                    <td className="py-1.5 pr-3">{row.tasks}</td>
                    <td className="py-1.5 pr-3">{row.firstPassApprovalRate === null ? unmeasured : `${Math.round(row.firstPassApprovalRate * 100)} %`}</td>
                    <td className="py-1.5 pr-3">{row.retries}</td>
                    <td className="py-1.5 pr-3">{row.estimatedCostUsd === null ? unmeasured : formatUsd(row.estimatedCostUsd)}</td>
                    <td className="py-1.5 pr-3">
                      {row.latencyP50Ms === null || row.latencyP90Ms === null
                        ? unmeasured
                        : `${row.latencyP50Ms} / ${row.latencyP90Ms} ms`}
                    </td>
                    <td className="py-1.5 text-gray-500 dark:text-gray-400">{t('agentQuality.unrecorded')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-2xs leading-snug text-gray-500 dark:text-gray-400">{t('agentQuality.note')}</p>
        </>
      )}
    </Card>
  );
};

export default AgentQualityPanel;

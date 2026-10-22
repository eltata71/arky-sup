/**
 * El contrato del agente frente a lo que la organización le añadió (16.5): si
 * el producto lo cambió después de personalizarlo, en qué se distingue de
 * fábrica, y el historial de cambios de la ficha (16.4).
 *
 * Todo lo que muestra lo deriva el dominio (`describeContractDrift`,
 * `describeProfileDifferences`) o la bitácora del servidor; aquí sólo se
 * redacta. Una pantalla que calculara la deriva sería una segunda definición.
 */

import React from 'react';
import { History, GitCompare } from 'lucide-react';
import { Alert, Badge, cn } from '../../ui';
import { useUiTranslation } from '../../../lib/i18n/UiTranslationContext';
import {
  describeContractDrift,
  describeProfileDifferences,
  type OfficeAgentProfileOverride,
  type ProfileDifference,
} from '../../../services/architectureOffice/agents'; // the cards' door, not the barrel (F6-05)
import type { OfficeAgentId } from '../../../services/architectureOffice/agents';
import { useAgentProfileChanges } from '../../../hooks/useAgentProfileChanges';

const TITLE = 'text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400';

export interface AgentContractSectionProps {
  agentId: OfficeAgentId;
  override?: OfficeAgentProfileOverride;
}

export const AgentContractSection: React.FC<AgentContractSectionProps> = ({ agentId, override }) => {
  const t = useUiTranslation();
  const drift = describeContractDrift(agentId, override);
  const differences = describeProfileDifferences(agentId, override);
  const { changes, loading } = useAgentProfileChanges(agentId, override?.revision ?? 0);

  const show = (value: string | number | boolean | undefined, field: string): string => {
    if (value === undefined || value === '') return t('agentProfile.diff.none');
    if (field === 'enabled') return value ? t('agentProfile.diff.enabled') : t('agentProfile.diff.disabled');
    return String(value);
  };

  const row = (difference: ProfileDifference) => (
    <li key={difference.field} className="space-y-1 rounded-lg bg-gray-50 px-2.5 py-2 dark:bg-gray-900/50">
      <p className={TITLE}>{t(`agentProfile.diff.field.${difference.field}`)}</p>
      {difference.kind === 'replaces' ? (
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-xs text-gray-700 dark:text-gray-200">
          <dt className="text-gray-500 dark:text-gray-400">{t('agentProfile.diff.factory')}</dt>
          <dd>{show(difference.factory, difference.field)}</dd>
          <dt className="text-gray-500 dark:text-gray-400">{t('agentProfile.diff.organization')}</dt>
          <dd>{show(difference.organization, difference.field)}</dd>
          <dt className="text-gray-500 dark:text-gray-400">{t('agentProfile.diff.effective')}</dt>
          <dd className="font-medium">{show(difference.effective, difference.field)}</dd>
        </dl>
      ) : (
        <>
          <p className="text-2xs text-gray-500 dark:text-gray-400">
            {t('agentProfile.diff.adds', { p0: String(difference.added.length), p1: String(difference.inherited) })}
          </p>
          <ul className="space-y-0.5">
            {difference.added.map((entry) => (
              <li key={entry} className="text-xs leading-relaxed text-gray-800 dark:text-gray-100">{entry}</li>
            ))}
          </ul>
        </>
      )}
    </li>
  );

  return (
    <>
      <section className="space-y-2 rounded-2xl border border-gray-100 bg-white/70 p-3.5 dark:border-gray-800 dark:bg-gray-900/40">
        <h3 className={cn(TITLE, 'flex items-center gap-1.5')}>
          <GitCompare className="h-3.5 w-3.5 text-primary-500" aria-hidden />
          {t('agentProfile.diff.title')}
        </h3>
        {drift.status === 'drifted' && (
          <Alert tone="warning" role="status">
            {t('agentProfile.drift.drifted', { p0: String(drift.customizedAgainst), p1: String(drift.current) })}
          </Alert>
        )}
        {drift.status === 'unrecorded' && (
          <Alert tone="info" role="status">
            {t('agentProfile.drift.unrecorded', { p0: String(drift.current) })}
          </Alert>
        )}
        <p className="text-2xs leading-snug text-gray-500 dark:text-gray-400">
          {drift.status === 'current'
            ? t('agentProfile.drift.current', { p0: String(drift.customizedAgainst) })
            : drift.status === 'not-customized'
              ? t('agentProfile.drift.not-customized', { p0: String(drift.current) })
              : t('agentProfile.diff.hint')}
        </p>
        {differences.length === 0 ? (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
            {t('agentProfile.diff.empty')}
          </p>
        ) : (
          <ul className="space-y-1.5">{differences.map(row)}</ul>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-gray-100 bg-white/70 p-3.5 dark:border-gray-800 dark:bg-gray-900/40">
        <h3 className={cn(TITLE, 'flex items-center gap-1.5')}>
          <History className="h-3.5 w-3.5 text-primary-500" aria-hidden />
          {t('agentProfile.history.title')}
        </h3>
        {loading ? (
          <p className="text-xs text-gray-500 dark:text-gray-400" role="status">{t('agentProfile.history.loading')}</p>
        ) : changes.length === 0 ? (
          <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
            {t('agentProfile.history.empty')}
          </p>
        ) : (
          <ol className="space-y-1">
            {changes.map((change) => (
              <li key={`${change.revision}-${change.changedAt}`} className="rounded-lg bg-gray-50 px-2.5 py-1.5 dark:bg-gray-900/50">
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-gray-800 dark:text-gray-100">
                  <Badge tone={change.action === 'reset' ? 'warning' : 'gray'} size="xs">
                    {t(`agentProfile.history.${change.action}`)}
                  </Badge>
                  <span>{t('agentProfile.history.entry', { p0: String(change.revision), p1: new Date(change.changedAt).toLocaleString() })}</span>
                  {change.contractVersion !== null && (
                    <span className="text-gray-500 dark:text-gray-400">{t('agentProfile.history.contract', { p0: String(change.contractVersion) })}</span>
                  )}
                </p>
                {change.changedFields.length > 0 && (
                  <p className="text-2xs text-gray-500 dark:text-gray-400">
                    {t('agentProfile.history.fields', { p0: change.changedFields.map((field) => t(`agentProfile.diff.field.${field}`)).join(', ') })}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
};

export default AgentContractSection;

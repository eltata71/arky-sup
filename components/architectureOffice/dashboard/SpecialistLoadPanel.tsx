/**
 * Who is carrying what.
 *
 * Sorted by active load, so the reader sees the bottleneck first. Idle
 * specialists still appear — knowing that a domain expert is free is as useful
 * as knowing another is swamped.
 */

import React from 'react';
import { Badge, Card, EmptyState, cn } from '../../ui';
import { OFFICE_AGENT_PERSONAS, type OfficeAgentId } from '../../../services/architectureOffice/domain/officeAgentPersonas';
import { PersonaAvatar } from '../PersonaAvatar';
import { OFFICE_HEALTH_VISUALS } from '../officeChartTokens';
import type { OfficeSpecialistLoad } from '../../../services/architectureOffice/domain/officePortfolio';

export interface SpecialistLoadPanelProps {
  specialists: OfficeSpecialistLoad[];
  className?: string;
}

export const SpecialistLoadPanel: React.FC<SpecialistLoadPanelProps> = ({
  specialists,
  className,
}) => {
  const busiest = Math.max(1, ...specialists.map((entry) => entry.active));
  const working = specialists.filter((entry) => entry.active > 0 || entry.completed > 0 || entry.reviewed > 0);

  if (working.length === 0) {
    return (
      <EmptyState
        title="Ningún especialista tiene trabajo asignado"
        description="En cuanto apruebes un charter, la Oficina repartirá las tareas entre los 13 especialistas y verás aquí su carga real."
        flavor="ai"
        className={className}
      />
    );
  }

  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 xl:grid-cols-3', className)}>
      {working.map((entry) => {
        const persona = OFFICE_AGENT_PERSONAS[entry.personaId as OfficeAgentId];
        return (
          <Card key={entry.personaId} compact className="space-y-2.5">
            <div className="flex items-start gap-2.5">
              <PersonaAvatar personaId={entry.personaId} size="md" decorative />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {persona?.alias ?? entry.personaId}
                </p>
                <p className="truncate text-2xs text-gray-500 dark:text-gray-400">
                  {persona?.role ?? 'Especialista'}
                </p>
              </div>
              {entry.active > 0 ? (
                <Badge tone="primary" size="xs" dot>{entry.active} activa(s)</Badge>
              ) : (
                <Badge tone="gray" size="xs" outline>Libre</Badge>
              )}
            </div>

            {/* Load relative to the busiest specialist — a comparison, not a
                percentage of some invented capacity. */}
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
              role="progressbar"
              aria-valuenow={entry.active}
              aria-valuemin={0}
              aria-valuemax={busiest}
              aria-label={`Carga de ${persona?.alias ?? entry.personaId}`}
            >
              <div
                className={cn('h-full rounded-full transition-all duration-500', OFFICE_HEALTH_VISUALS.running.surface)}
                style={{ width: `${Math.round((entry.active / busiest) * 100)}%` }}
              />
            </div>

            <dl className="flex gap-4 text-2xs">
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Completadas</dt>
                <dd className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{entry.completed}</dd>
              </div>
              <div>
                <dt className="text-gray-500 dark:text-gray-400">Revisiones</dt>
                <dd className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{entry.reviewed}</dd>
              </div>
            </dl>

            {entry.activeTaskTitles.length > 0 && (
              <ul className="space-y-0.5 border-t border-gray-100 pt-2 dark:border-gray-800">
                {entry.activeTaskTitles.slice(0, 3).map((title, index) => (
                  <li
                    key={`${entry.personaId}-${index}`}
                    className="truncate text-2xs text-gray-600 dark:text-gray-300"
                  >
                    {title}
                  </li>
                ))}
                {entry.activeTaskTitles.length > 3 && (
                  <li className="text-2xs text-gray-400 dark:text-gray-500">
                    y {entry.activeTaskTitles.length - 3} más
                  </li>
                )}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
};

export default SpecialistLoadPanel;

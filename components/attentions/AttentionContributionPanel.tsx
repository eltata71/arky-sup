/**
 * Qué mueve este proyecto en la iniciativa que lo justifica.
 *
 * Es el panel que cierra el hueco del que nace toda esta funcionalidad. El
 * enlace entre los dos niveles ya existía y era un id, así que el sistema
 * siempre supo *que* un proyecto responde a una iniciativa; lo que no sabía
 * decir es *qué cambia para el negocio cuando este proyecto avanza*. Sin eso,
 * la iniciativa acaba siendo una carpeta con proyectos dentro.
 *
 * Tres reglas que este panel sostiene:
 *
 * 1. **El resultado y el indicador son ids, nunca texto copiado.** Se eligen de
 *    los que la iniciativa tiene declarados. Una frase copiada sobrevive a que
 *    reescriban el resultado y empieza a mentir en silencio.
 * 2. **El peso es opcional y se declara, no se supone.** Mientras nadie declare
 *    ninguno, la consolidación reparte por igual y lo dice. Un peso inventado
 *    tiene el aspecto de una medición.
 * 3. **Sin iniciativa no hay aporte.** Si el proyecto todavía no está enlazado,
 *    el panel manda a enlazarlo en vez de ofrecer escribir a quién sirve: eso
 *    sería capturar una relación como texto libre, que es lo que el modelo de
 *    claves existe para impedir.
 */

import React, { useState } from 'react';
import { Badge, Button, Input, cn } from '../ui';
import { Link2, Plus } from 'lucide-react';
import { EmptyRow, RemoveButton, SectionCard, selectClass } from '../businessInitiatives/panelPrimitives';
import { CONTRIBUTION_STATE_LABELS, CONTRIBUTION_STATE_TONES } from './attentionUiLabels';
import type { BusinessInitiative } from '../../services/businessInitiatives';
import type {
  AttentionContribution,
  AttentionContributionState,
  Project,
  ProjectAttentionTracking,
} from '../../services/architectureProjects';

const BASE_TRACKING: ProjectAttentionTracking = { status: 'discovery', priority: 'medium' };

interface Draft {
  initiativeId: string;
  statement: string;
  outcomeId: string;
  kpiId: string;
  weight: string;
  state: AttentionContributionState;
}

const EMPTY_DRAFT: Draft = {
  initiativeId: '',
  statement: '',
  outcomeId: '',
  kpiId: '',
  weight: '',
  state: 'planned',
};

export interface AttentionContributionPanelProps {
  project: Project;
  /** Sólo las iniciativas que este proyecto atiende, ya resueltas. */
  initiatives: readonly BusinessInitiative[];
  onPatch: (patch: { attention: ProjectAttentionTracking }) => void;
  busy?: boolean;
}

export const AttentionContributionPanel: React.FC<AttentionContributionPanelProps> = ({
  project,
  initiatives,
  onPatch,
  busy,
}) => {
  const tracking = project.attention ?? BASE_TRACKING;
  const contributions = tracking.contributions ?? [];
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  const selectedInitiative = initiatives.find((entry) => entry.id === draft.initiativeId)
    ?? initiatives[0];
  const initiativeById = new Map(initiatives.map((entry) => [entry.id, entry]));

  const add = (): void => {
    const initiativeId = draft.initiativeId || selectedInitiative?.id;
    if (!initiativeId || !draft.statement.trim()) return;
    const weight = Number.parseInt(draft.weight, 10);
    const contribution: AttentionContribution = {
      id: `aporte-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      initiativeId,
      statement: draft.statement.trim(),
      outcomeId: draft.outcomeId || undefined,
      kpiId: draft.kpiId || undefined,
      weight: Number.isFinite(weight) && weight > 0 ? Math.min(100, weight) : undefined,
      state: draft.state,
    };
    onPatch({ attention: { ...tracking, contributions: [...contributions, contribution] } });
    setDraft(EMPTY_DRAFT);
  };

  const setState = (id: string, state: AttentionContributionState): void => {
    onPatch({
      attention: {
        ...tracking,
        contributions: contributions.map((entry) => (entry.id === id ? { ...entry, state } : entry)),
      },
    });
  };

  /** Cómo se lee un aporte: a quién sirve y contra qué se mide. */
  const describe = (contribution: AttentionContribution): string => {
    const initiative = initiativeById.get(contribution.initiativeId);
    const outcome = initiative?.expectedOutcomes.find((entry) => entry.id === contribution.outcomeId);
    const kpi = initiative?.kpis.find((entry) => entry.id === contribution.kpiId);
    const parts = [initiative ? (initiative.code || initiative.title) : 'Iniciativa no encontrada'];
    if (contribution.outcomeId) parts.push(outcome ? `Resultado: ${outcome.statement}` : 'Resultado que ya no existe');
    if (contribution.kpiId) parts.push(kpi ? `Indicador: ${kpi.name}` : 'Indicador que ya no existe');
    if (contribution.weight) parts.push(`Peso ${contribution.weight}`);
    return parts.join(' · ');
  };

  return (
    <SectionCard
      icon={Link2}
      title="Impacto en la iniciativa"
      hint="Qué mueve este proyecto en la necesidad de negocio que lo justifica."
      count={contributions.length}
    >
      {initiatives.length === 0 ? (
        <EmptyRow>
          Este proyecto no está enlazado a ninguna iniciativa todavía. Enlázalo desde el panel de la
          Oficina y aquí podrás declarar qué mueve en ella.
        </EmptyRow>
      ) : (
        <>
          {contributions.length === 0
            ? (
              <EmptyRow>
                Sin aportes declarados. La iniciativa sabe que este proyecto la atiende, pero no qué
                cambia cuando avanza.
              </EmptyRow>
            )
            : (
              <ul className="space-y-1.5">
                {contributions.map((contribution) => (
                  <li key={contribution.id} className="rounded-lg bg-gray-50 px-2.5 py-2 dark:bg-gray-900/50">
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm leading-relaxed text-gray-800 dark:text-gray-100">
                          {contribution.statement}
                        </span>
                        <span className="mt-0.5 block text-2xs text-gray-500 dark:text-gray-400">
                          {describe(contribution)}
                        </span>
                      </span>
                      <Badge tone={CONTRIBUTION_STATE_TONES[contribution.state]} size="xs">
                        {CONTRIBUTION_STATE_LABELS[contribution.state]}
                      </Badge>
                      <RemoveButton
                        label={`Quitar el aporte ${contribution.statement}`}
                        disabled={busy}
                        onClick={() => onPatch({
                          attention: {
                            ...tracking,
                            contributions: contributions.filter((entry) => entry.id !== contribution.id),
                          },
                        })}
                      />
                    </div>
                    <select
                      aria-label={`Estado del aporte ${contribution.statement}`}
                      className={cn(selectClass, 'mt-1.5')}
                      value={contribution.state}
                      disabled={busy}
                      onChange={(event) => setState(contribution.id, event.target.value as AttentionContributionState)}
                    >
                      {Object.entries(CONTRIBUTION_STATE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}

          <div className="space-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-800">
            <Input
              aria-label="Ej. Deja el alta de póliza disponible por API para el canal de corredores"
              placeholder="Ej. Deja el alta de póliza disponible por API para el canal de corredores"
              value={draft.statement}
              onChange={(event) => setDraft((current) => ({ ...current, statement: event.target.value }))}
            />
            <div className="grid grid-cols-2 gap-1.5">
              {initiatives.length > 1 && (
                <select
                  aria-label="Iniciativa a la que aporta"
                  className={cn(selectClass, 'col-span-2')}
                  value={draft.initiativeId || (selectedInitiative?.id ?? '')}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    initiativeId: event.target.value,
                    outcomeId: '',
                    kpiId: '',
                  }))}
                >
                  {initiatives.map((entry) => (
                    <option key={entry.id} value={entry.id}>{entry.code || entry.title}</option>
                  ))}
                </select>
              )}
              <select
                aria-label="Resultado esperado al que sirve"
                className={selectClass}
                value={draft.outcomeId}
                onChange={(event) => setDraft((current) => ({ ...current, outcomeId: event.target.value }))}
              >
                <option value="">Sin resultado concreto</option>
                {(selectedInitiative?.expectedOutcomes ?? []).map((outcome) => (
                  <option key={outcome.id} value={outcome.id}>{outcome.statement}</option>
                ))}
              </select>
              <select
                aria-label="Indicador que mueve"
                className={selectClass}
                value={draft.kpiId}
                onChange={(event) => setDraft((current) => ({ ...current, kpiId: event.target.value }))}
              >
                <option value="">Sin indicador concreto</option>
                {(selectedInitiative?.kpis ?? []).map((kpi) => (
                  <option key={kpi.id} value={kpi.id}>{kpi.name}</option>
                ))}
              </select>
              <Input
                aria-label="Peso del aporte, de 1 a 100 (opcional)"
                type="number"
                min={1}
                max={100}
                placeholder="Peso del aporte, de 1 a 100 (opcional)"
                value={draft.weight}
                onChange={(event) => setDraft((current) => ({ ...current, weight: event.target.value }))}
              />
              <select
                aria-label="Estado del aporte"
                className={selectClass}
                value={draft.state}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  state: event.target.value as AttentionContributionState,
                }))}
              >
                {Object.entries(CONTRIBUTION_STATE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={add}
              disabled={busy || !draft.statement.trim()}
              fullWidth
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              Declarar el aporte
            </Button>
          </div>
        </>
      )}
    </SectionCard>
  );
};

export default AttentionContributionPanel;

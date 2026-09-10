/**
 * El seguimiento del proyecto de arquitectura: en qué estado está, cuánto ha
 * avanzado, qué se ha comprometido y qué puede pararlo.
 *
 * El nivel de arriba ya tenía todo esto —objetivos, indicadores, hitos,
 * riesgos— y el de en medio no tenía nada: un proyecto existía o no existía, y
 * la única señal de avance era cuántos artefactos había dentro. Eso basta para
 * trabajar y no basta para reportar, que es justo lo que se le pide a una
 * oficina de arquitectura en una reunión de seguimiento.
 *
 * Dos decisiones de forma:
 *
 *  - **El semáforo no se elige, se calcula.** No hay desplegable de «salud»
 *    porque un estado de salud que se teclea es una opinión con aspecto de
 *    medición y siempre está en verde. Sale de los hitos, de los riesgos y de
 *    la fecha, y la pantalla explica de dónde.
 *  - **Se guarda al salir del campo**, como el resto de la ficha: una escritura
 *    por pulsación contra Firestore es una factura y una carrera entre
 *    versiones.
 */

import React, { useCallback, useState } from 'react';
import { Badge, Button, Input, cn } from '../ui';
import { CalendarClock, Plus, ShieldAlert } from 'lucide-react';
import {
  EmptyRow,
  RemoveButton,
  SectionCard,
  selectClass,
  // Las piezas de una sección de ficha se escribieron primero para la
  // iniciativa; son la misma forma —encabezado, entradas, fila para añadir— y
  // duplicarlas aquí daría dos paneles que se parecen en vez de uno que se
  // aprende una vez.
} from '../businessInitiatives/panelPrimitives';
import {
  ATTENTION_MILESTONE_LABELS,
  ATTENTION_MILESTONE_TONES,
  ATTENTION_PRIORITY_LABELS,
  ATTENTION_RISK_LABELS,
  ATTENTION_RISK_TONES,
  ATTENTION_STATUS_LABELS,
} from './attentionUiLabels';
import {
  attentionProgress,
  type AttentionMilestone,
  type AttentionPriority,
  type AttentionRisk,
  type AttentionRiskLevel,
  type AttentionStatus,
  type Project,
  type ProjectAttentionTracking,
} from '../../services/architectureProjects';

/** El seguimiento con el que arranca un proyecto que nunca lo tuvo. */
const BASE_TRACKING: ProjectAttentionTracking = { status: 'discovery', priority: 'medium' };

export interface AttentionTrackingPanelProps {
  project: Project;
  onPatch: (patch: { attention: ProjectAttentionTracking }) => void;
  busy?: boolean;
}

const newRowId = (prefix: string): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const AttentionTrackingPanel: React.FC<AttentionTrackingPanelProps> = ({
  project,
  onPatch,
  busy,
}) => {
  const tracking = project.attention ?? BASE_TRACKING;
  const progress = attentionProgress(project.attention);

  const [leadDraft, setLeadDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [milestone, setMilestone] = useState<{ name: string; dueAt: string }>({ name: '', dueAt: '' });
  const [risk, setRisk] = useState<{ description: string; level: AttentionRiskLevel }>({
    description: '',
    level: 'medium',
  });

  const patch = useCallback((changes: Partial<ProjectAttentionTracking>) => {
    onPatch({ attention: { ...tracking, ...changes } });
  }, [onPatch, tracking]);

  const milestones = tracking.milestones ?? [];
  const risks = tracking.risks ?? [];

  const addMilestone = (): void => {
    if (!milestone.name.trim() || !milestone.dueAt) return;
    patch({
      milestones: [...milestones, {
        id: newRowId('hito'),
        name: milestone.name.trim(),
        dueAt: milestone.dueAt,
        status: 'pending',
      }],
    });
    setMilestone({ name: '', dueAt: '' });
  };

  const addRisk = (): void => {
    if (!risk.description.trim()) return;
    patch({
      risks: [...risks, {
        id: newRowId('riesgo'),
        description: risk.description.trim(),
        level: risk.level,
      }],
    });
    setRisk({ description: '', level: 'medium' });
  };

  const setMilestoneStatus = (id: string, status: AttentionMilestone['status']): void => {
    patch({
      milestones: milestones.map((entry) => (entry.id === id
        ? { ...entry, status, completedAt: status === 'met' ? new Date().toISOString() : undefined }
        : entry)),
    });
  };

  return (
    <SectionCard
      icon={CalendarClock}
      title="Seguimiento"
      hint="En qué estado está, cuánto ha avanzado y para cuándo se ha comprometido."
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor="attention-status" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
            Estado
          </label>
          <select
            id="attention-status"
            className={cn(selectClass, 'w-full')}
            value={tracking.status}
            disabled={busy}
            onChange={(event) => patch({ status: event.target.value as AttentionStatus })}
          >
            {Object.entries(ATTENTION_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="attention-priority" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
            Prioridad
          </label>
          <select
            id="attention-priority"
            className={cn(selectClass, 'w-full')}
            value={tracking.priority}
            disabled={busy}
            onChange={(event) => patch({ priority: event.target.value as AttentionPriority })}
          >
            {Object.entries(ATTENTION_PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="attention-lead" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
          Arquitecto responsable
        </label>
        <Input
          id="attention-lead"
          value={leadDraft ?? tracking.architectureLead ?? ''}
          disabled={busy}
          placeholder="Quién responde por esta arquitectura"
          onChange={(event) => setLeadDraft(event.target.value)}
          onBlur={() => {
            if (leadDraft !== null && leadDraft.trim() !== (tracking.architectureLead ?? '')) {
              patch({ architectureLead: leadDraft.trim() || undefined });
            }
            setLeadDraft(null);
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label htmlFor="attention-start" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
            Inicio
          </label>
          <input
            id="attention-start"
            type="date"
            className={cn(selectClass, 'w-full')}
            value={(tracking.startDate ?? '').slice(0, 10)}
            disabled={busy}
            onChange={(event) => patch({ startDate: event.target.value || undefined })}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="attention-target" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
            Fecha objetivo
          </label>
          <input
            id="attention-target"
            type="date"
            className={cn(selectClass, 'w-full')}
            value={(tracking.targetEndDate ?? '').slice(0, 10)}
            disabled={busy}
            onChange={(event) => patch({ targetEndDate: event.target.value || undefined })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="attention-progress" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
            Avance declarado
          </label>
          <span className="text-2xs text-gray-500 dark:text-gray-400">
            {progress === null
              ? 'Sin declarar'
              : `${Math.round(progress.value * 100)} %${progress.source === 'milestones' ? ' (deducido de los hitos)' : ''}`}
          </span>
        </div>
        <input
          id="attention-progress"
          type="range"
          min={0}
          max={100}
          step={5}
          className="w-full accent-primary-600"
          value={tracking.progress ?? 0}
          disabled={busy}
          onChange={(event) => patch({ progress: Number(event.target.value) })}
        />
        {tracking.progress !== undefined && (
          <button
            type="button"
            onClick={() => patch({ progress: undefined })}
            className="text-2xs font-medium text-gray-500 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-400"
          >
            Quitar el avance declarado (volver a deducirlo de los hitos)
          </button>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="attention-health-note" className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
          Nota de situación
        </label>
        <textarea
          id="attention-health-note"
          rows={2}
          disabled={busy}
          placeholder="Una línea sobre por qué el proyecto está donde está"
          className="w-full resize-y rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm leading-relaxed text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          value={noteDraft ?? tracking.healthNote ?? ''}
          onChange={(event) => setNoteDraft(event.target.value)}
          onBlur={() => {
            if (noteDraft !== null && noteDraft.trim() !== (tracking.healthNote ?? '')) {
              patch({ healthNote: noteDraft.trim() || undefined });
            }
            setNoteDraft(null);
          }}
        />
      </div>

      {/* Hitos */}
      <div className="space-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-800">
        <p className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
          Hitos comprometidos
        </p>
        {milestones.length === 0
          ? <EmptyRow>Sin hitos. Sin ellos, el avance sólo puede declararse a mano.</EmptyRow>
          : (
            <ul className="space-y-1">
              {milestones.map((entry) => (
                <li key={entry.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-gray-900/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-800 dark:text-gray-100">{entry.name}</span>
                    <span className="text-2xs text-gray-500 dark:text-gray-400">{entry.dueAt.slice(0, 10)}</span>
                  </span>
                  <Badge tone={ATTENTION_MILESTONE_TONES[entry.status]} size="xs">
                    {ATTENTION_MILESTONE_LABELS[entry.status]}
                  </Badge>
                  <select
                    aria-label={`Estado del hito ${entry.name}`}
                    className={selectClass}
                    value={entry.status}
                    disabled={busy}
                    onChange={(event) => setMilestoneStatus(entry.id, event.target.value as AttentionMilestone['status'])}
                  >
                    {Object.entries(ATTENTION_MILESTONE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <RemoveButton
                    label={`Quitar el hito ${entry.name}`}
                    disabled={busy}
                    onClick={() => patch({ milestones: milestones.filter((item) => item.id !== entry.id) })}
                  />
                </li>
              ))}
            </ul>
          )}
        <div className="flex gap-2">
          <Input
            aria-label="Ej. Arquitectura de destino aprobada"
            placeholder="Ej. Arquitectura de destino aprobada"
            className="flex-1"
            value={milestone.name}
            onChange={(event) => setMilestone((draft) => ({ ...draft, name: event.target.value }))}
          />
          <input
            type="date"
            aria-label="Fecha del hito"
            className={selectClass}
            value={milestone.dueAt}
            onChange={(event) => setMilestone((draft) => ({ ...draft, dueAt: event.target.value }))}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={addMilestone}
            disabled={busy || !milestone.name.trim() || !milestone.dueAt}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      {/* Riesgos */}
      <div className="space-y-1.5 border-t border-gray-100 pt-3 dark:border-gray-800">
        <p className="flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
          Riesgos del proyecto
        </p>
        {risks.length === 0
          ? <EmptyRow>Sin riesgos registrados. Los altos y críticos los hereda la iniciativa.</EmptyRow>
          : (
            <ul className="space-y-1">
              {risks.map((entry: AttentionRisk) => (
                <li key={entry.id} className="flex items-start gap-2 rounded-lg bg-gray-50 px-2 py-1.5 dark:bg-gray-900/50">
                  <span className="min-w-0 flex-1 text-sm leading-relaxed text-gray-800 dark:text-gray-100">
                    {entry.description}
                  </span>
                  <Badge tone={ATTENTION_RISK_TONES[entry.level]} size="xs">
                    {ATTENTION_RISK_LABELS[entry.level]}
                  </Badge>
                  <RemoveButton
                    label={`Quitar el riesgo ${entry.description}`}
                    disabled={busy}
                    onClick={() => patch({ risks: risks.filter((item) => item.id !== entry.id) })}
                  />
                </li>
              ))}
            </ul>
          )}
        <div className="flex gap-2">
          <Input
            aria-label="Ej. El proveedor del core no confirma la ventana de migración"
            placeholder="Ej. El proveedor del core no confirma la ventana de migración"
            className="flex-1"
            value={risk.description}
            onChange={(event) => setRisk((draft) => ({ ...draft, description: event.target.value }))}
          />
          <select
            aria-label="Nivel del riesgo"
            className={selectClass}
            value={risk.level}
            onChange={(event) => setRisk((draft) => ({ ...draft, level: event.target.value as AttentionRiskLevel }))}
          >
            {Object.entries(ATTENTION_RISK_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <Button variant="secondary" size="sm" onClick={addRisk} disabled={busy || !risk.description.trim()}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </SectionCard>
  );
};

export default AttentionTrackingPanel;

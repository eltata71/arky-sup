/**
 * The editable sections of an initiative's record.
 *
 * Each panel is one question the discipline asks, kept separate so the screen
 * reads as a set of small complete areas rather than one long form. Every panel
 * follows the same shape — heading, current entries, one add row — so learning
 * the first teaches all six.
 *
 * Panels never hold a draft of the whole initiative: they emit a patch and the
 * context merges it. Two panels edited in sequence therefore cannot clobber
 * each other's fields.
 */

import React, { useCallback, useState } from 'react';
import { Badge, Button, Input, cn } from '../ui';
import { Plus } from 'lucide-react';
import { EmptyRow, RemoveButton, SectionCard, selectClass } from './panelPrimitives';
import { CaptureAssist } from '../capture';
import type { CaptureAssistantApi } from '../../hooks/useCaptureAssistant';
import type { CaptureContext } from '../../lib/capture';
import { formatPercent } from '../architectureOffice/officeChartTokens';
import {
  formatDate,
  INITIATIVE_SECTION_ICONS,
  MILESTONE_STATUS_LABELS,
  MILESTONE_STATUS_TONES,
  RISK_LEVEL_LABELS,
  RISK_LEVEL_TONES,
  STAKEHOLDER_KIND_LABELS,
} from './initiativeUiLabels';
import {
  kpiProgress,
  type BusinessInitiative,
  type InitiativeMilestoneStatus,
  type InitiativeRiskLevel,
  type InitiativeStakeholderKind,
  type InitiativeCommand,
} from '../../services/businessInitiatives/domain';

export interface PanelProps {
  initiative: BusinessInitiative;
  /**
   * Una operación con nombre, no un parche (F3-05). Lo que cada una hace —qué
   * fecha estampa, qué rechaza, en qué orden deja los hitos— lo decide
   * `applyInitiativeCommand`; el panel sólo dice qué quiere el usuario.
   */
  onCommand: (command: InitiativeCommand) => void;
  /** Read-only rendering, e.g. while a save is in flight. */
  busy?: boolean;
  /**
   * La asistencia de captura, cuando la pantalla la ofrece.
   *
   * Opcional porque un panel tiene que seguir funcionando sin ella: la ayuda
   * es una comodidad, y una ficha se rellena a mano cuando no hay modelo.
   *
   * Lo que un panel hace con una sugerencia es rellenar **su fila de añadir**,
   * no escribir en el registro. En objetivos —una lista de frases— la
   * diferencia no se nota; en hitos, indicadores y riesgos sí: cada uno pide
   * además una fecha, una unidad o un nivel, y eso lo pone una persona. El
   * asistente redacta; quien confirma es quien firma.
   */
  assist?: { assistant: CaptureAssistantApi; context: CaptureContext | null };
}

// ---------------------------------------------------------------------------
// Objectives and outcomes
// ---------------------------------------------------------------------------

export const OutcomesPanel: React.FC<PanelProps> = ({ initiative, onCommand, busy, assist }) => {
  const [objective, setObjective] = useState('');
  const [statement, setStatement] = useState('');
  const [measure, setMeasure] = useState('');

  const addObjective = useCallback(() => {
    const value = objective.trim();
    if (!value) return;
    onCommand({ kind: 'add-objective', objective: value });
    setObjective('');
  }, [objective, onCommand]);

  const addOutcome = useCallback(() => {
    const value = statement.trim();
    if (!value) return;
    onCommand({ kind: 'add-outcome', statement: value, measure: measure.trim() || undefined });
    setStatement('');
    setMeasure('');
  }, [statement, measure, onCommand]);

  return (
    <SectionCard
      id="objetivos"
      icon={INITIATIVE_SECTION_ICONS.outcomes}
      title="Objetivos y resultados esperados"
      hint="Qué se quiere lograr y cómo se sabrá que ocurrió. Nunca cómo construirlo."
      count={initiative.objectives.length + initiative.expectedOutcomes.length}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
            Objetivos
          </p>
          {assist && (
            <CaptureAssist
              fieldId="initiative.objectives"
              assistant={assist.assistant}
              context={assist.context}
              applied={initiative.objectives}
              apply={setObjective}
            />
          )}
        </div>
        {initiative.objectives.length === 0 ? (
          <EmptyRow>Sin objetivos declarados. Sin ellos no se puede juzgar si la iniciativa se cumplió.</EmptyRow>
        ) : (
          <ul className="space-y-1">
            {initiative.objectives.map((item, index) => (
              <li key={`${item}-${index}`} className="flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" aria-hidden />
                <span className="min-w-0 flex-1 text-sm leading-relaxed text-gray-700 dark:text-gray-200">{item}</span>
                <RemoveButton
                  label={`Quitar objetivo ${item}`}
                  disabled={busy}
                  onClick={() => onCommand({ kind: 'remove-objective', index })}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            aria-label="Ej. Responder el 80 % de las pre-autorizaciones en menos de 2 minutos"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addObjective(); } }}
            placeholder="Ej. Responder el 80 % de las pre-autorizaciones en menos de 2 minutos"
            className="flex-1"
          />
          <Button variant="secondary" size="sm" onClick={addObjective} disabled={busy || !objective.trim()}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="space-y-2 border-t border-gray-100 pt-3 dark:border-gray-800">
        <div className="flex items-center justify-between gap-2">
          <p className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
            Resultados esperados
          </p>
          {assist && (
            <CaptureAssist
              fieldId="initiative.outcomes"
              assistant={assist.assistant}
              context={assist.context}
              applied={initiative.expectedOutcomes.map((outcome) => outcome.statement)}
              apply={setStatement}
            />
          )}
        </div>
        {initiative.expectedOutcomes.length === 0 ? (
          <EmptyRow>Sin resultados esperados. Un objetivo sin resultado medible no se puede cerrar.</EmptyRow>
        ) : (
          <ul className="space-y-1.5">
            {initiative.expectedOutcomes.map((outcome) => (
              <li key={outcome.id} className="flex items-start gap-2 rounded-lg px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-200">{outcome.statement}</p>
                  {outcome.measure
                    ? <p className="text-2xs text-gray-500 dark:text-gray-400">Se evidencia con: {outcome.measure}</p>
                    : <p className="text-2xs text-amber-600 dark:text-amber-400">Falta acordar cómo se evidencia.</p>}
                </div>
                <RemoveButton
                  label={`Quitar resultado ${outcome.statement}`}
                  disabled={busy}
                  onClick={() => onCommand({ kind: 'remove-outcome', outcomeId: outcome.id })}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-[2fr_2fr_auto]">
          <Input
            aria-label="Resultado esperado"
            value={statement}
            onChange={(event) => setStatement(event.target.value)}
            placeholder="Resultado esperado"
          />
          <Input
            aria-label="Cómo se evidencia"
            value={measure}
            onChange={(event) => setMeasure(event.target.value)}
            placeholder="Cómo se evidencia"
          />
          <Button variant="secondary" size="sm" onClick={addOutcome} disabled={busy || !statement.trim()}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export const KpiPanel: React.FC<PanelProps> = ({ initiative, onCommand, busy, assist }) => {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [baseline, setBaseline] = useState('');
  const [target, setTarget] = useState('');

  const parse = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const addKpi = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCommand({ kind: 'add-kpi', name: trimmed, unit, baseline: parse(baseline), target: parse(target) });
    setName(''); setUnit(''); setBaseline(''); setTarget('');
  }, [name, unit, baseline, target, onCommand]);

  /**
   * El asistente propone «Nombre (unidad)» porque un indicador sin unidad no
   * sirve — la regla está en el catálogo de campos. Aquí se deshace el paréntesis
   * para que la fila de añadir quede lista, no para guardar nada: la línea base
   * y la meta las pone quien las conoce.
   */
  const applyKpiSuggestion = useCallback((value: string) => {
    const match = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(value);
    setName((match ? match[1] : value).trim());
    setUnit(match ? match[2].trim() : '');
  }, []);

  const setCurrent = useCallback((kpiId: string, raw: string) => {
    onCommand({ kind: 'record-kpi-measurement', kpiId, value: parse(raw) });
  }, [onCommand]);

  return (
    <SectionCard
      id="indicadores"
      icon={INITIATIVE_SECTION_ICONS.indicators}
      title="Indicadores (KPI)"
      action={assist && (
        <CaptureAssist
          fieldId="initiative.kpis"
          assistant={assist.assistant}
          context={assist.context}
          applied={initiative.kpis.map((kpi) => `${kpi.name} (${kpi.unit})`)}
          apply={applyKpiSuggestion}
        />
      )}
      hint="Un indicador sin línea base y meta no puede mostrar avance; el tablero lo dice en vez de dibujar una barra vacía."
      count={initiative.kpis.length}
    >
      {initiative.kpis.length === 0 ? (
        <EmptyRow>Sin indicadores. Son la única forma de cerrar la iniciativa con evidencia.</EmptyRow>
      ) : (
        <ul className="space-y-2">
          {initiative.kpis.map((kpi) => {
            const progress = kpiProgress(kpi);
            return (
              <li key={kpi.id} className="rounded-lg border border-gray-200 p-2.5 dark:border-gray-800">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">{kpi.name}</p>
                    <p className="text-2xs text-gray-500 dark:text-gray-400">
                      {kpi.unit || 'sin unidad'}
                      {kpi.baseline !== undefined && ` · base ${kpi.baseline}`}
                      {kpi.target !== undefined ? ` · meta ${kpi.target}` : ' · sin meta'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Input
                      aria-label={`Valor actual de ${kpi.name}`}
                      value={kpi.current === undefined ? '' : String(kpi.current)}
                      onChange={(event) => setCurrent(kpi.id, event.target.value)}
                      placeholder="Actual"
                      className="h-8 w-20 text-xs"
                      disabled={busy}
                    />
                    <RemoveButton
                      label={`Quitar indicador ${kpi.name}`}
                      disabled={busy}
                      onClick={() => onCommand({ kind: 'remove-kpi', kpiId: kpi.id })}
                    />
                  </div>
                </div>
                {progress === null ? (
                  <p className="mt-1.5 text-2xs text-amber-600 dark:text-amber-400">
                    Sin meta o sin valor actual: todavía no se puede medir el avance.
                  </p>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <div
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800"
                      role="progressbar"
                      aria-valuenow={Math.round(progress * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`Avance de ${kpi.name}`}
                    >
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          progress >= 1 ? 'bg-[#059669]' : 'bg-[#4f46e5] dark:bg-[#6366f1]',
                        )}
                        style={{ width: `${Math.round(progress * 100)}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-2xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                      {formatPercent(progress)}
                    </span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <Input aria-label="Indicador" value={name} onChange={(e) => setName(e.target.value)} placeholder="Indicador" />
        <Input aria-label="Unidad" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unidad" />
        <Input aria-label="Línea base" value={baseline} onChange={(e) => setBaseline(e.target.value)} placeholder="Línea base" />
        <Input aria-label="Meta" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Meta" />
        <Button variant="secondary" size="sm" onClick={addKpi} disabled={busy || !name.trim()}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export const MilestonePanel: React.FC<PanelProps> = ({ initiative, onCommand, busy, assist }) => {
  const [name, setName] = useState('');
  const [dueAt, setDueAt] = useState('');

  const addMilestone = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed || !dueAt) return;
    onCommand({ kind: 'add-milestone', name: trimmed, dueAt: new Date(dueAt).toISOString() });
    setName(''); setDueAt('');
  }, [name, dueAt, onCommand]);

  const setStatus = useCallback((milestoneId: string, status: InitiativeMilestoneStatus) => {
    onCommand({ kind: 'set-milestone-status', milestoneId, status });
  }, [onCommand]);

  return (
    <SectionCard
      id="hitos"
      icon={INITIATIVE_SECTION_ICONS.timeline}
      title="Hitos"
      action={assist && (
        <CaptureAssist
          fieldId="initiative.milestones"
          assistant={assist.assistant}
          context={assist.context}
          applied={initiative.milestones.map((milestone) => milestone.name)}
          apply={setName}
        />
      )}
      hint="Los compromisos de fecha con el negocio. Un hito incumplido pone la iniciativa en riesgo automáticamente."
      count={initiative.milestones.length}
    >
      {initiative.milestones.length === 0 ? (
        <EmptyRow>Sin hitos. El estado solo podrá deducirse de la fecha objetivo global.</EmptyRow>
      ) : (
        <ul className="space-y-1.5">
          {initiative.milestones.map((milestone) => (
            <li key={milestone.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 dark:border-gray-800">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-800 dark:text-gray-100">{milestone.name}</span>
                <span className="text-2xs text-gray-500 dark:text-gray-400">{formatDate(milestone.dueAt)}</span>
              </span>
              <Badge tone={MILESTONE_STATUS_TONES[milestone.status]} size="xs">
                {MILESTONE_STATUS_LABELS[milestone.status]}
              </Badge>
              <select
                aria-label={`Estado de ${milestone.name}`}
                value={milestone.status}
                onChange={(event) => setStatus(milestone.id, event.target.value as InitiativeMilestoneStatus)}
                className={selectClass}
                disabled={busy}
              >
                {(Object.keys(MILESTONE_STATUS_LABELS) as InitiativeMilestoneStatus[]).map((value) => (
                  <option key={value} value={value}>{MILESTONE_STATUS_LABELS[value]}</option>
                ))}
              </select>
              <RemoveButton
                label={`Quitar hito ${milestone.name}`}
                disabled={busy}
                onClick={() => onCommand({ kind: 'remove-milestone', milestoneId: milestone.id })}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
        <Input aria-label="Hito" value={name} onChange={(e) => setName(e.target.value)} placeholder="Hito" />
        <Input aria-label="Fecha del hito" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        <Button variant="secondary" size="sm" onClick={addMilestone} disabled={busy || !name.trim() || !dueAt}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Risks
// ---------------------------------------------------------------------------

export const RiskPanel: React.FC<PanelProps> = ({ initiative, onCommand, busy, assist }) => {
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<InitiativeRiskLevel>('medium');
  const [mitigation, setMitigation] = useState('');

  const addRisk = useCallback(() => {
    const trimmed = description.trim();
    if (!trimmed) return;
    onCommand({ kind: 'add-risk', description: trimmed, level, mitigation: mitigation.trim() || undefined });
    setDescription(''); setMitigation(''); setLevel('medium');
  }, [description, level, mitigation, onCommand]);

  return (
    <SectionCard
      id="riesgos"
      icon={INITIATIVE_SECTION_ICONS.risks}
      title="Riesgos"
      action={assist && (
        <CaptureAssist
          fieldId="initiative.risks"
          assistant={assist.assistant}
          context={assist.context}
          applied={initiative.risks.map((risk) => risk.description)}
          apply={setDescription}
        />
      )}
      hint="Un riesgo crítico pone la iniciativa en riesgo, sin importar el estado que se haya marcado a mano."
      count={initiative.risks.length}
    >
      {initiative.risks.length === 0 ? (
        <EmptyRow>Sin riesgos declarados.</EmptyRow>
      ) : (
        <ul className="space-y-1.5">
          {initiative.risks.map((risk) => (
            <li key={risk.id} className="flex items-start gap-2 rounded-lg border border-gray-200 px-2.5 py-2 dark:border-gray-800">
              <Badge tone={RISK_LEVEL_TONES[risk.level]} size="xs">{RISK_LEVEL_LABELS[risk.level]}</Badge>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-gray-700 dark:text-gray-200">{risk.description}</p>
                {risk.mitigation
                  ? <p className="text-2xs text-gray-500 dark:text-gray-400">Mitigación: {risk.mitigation}</p>
                  : <p className="text-2xs text-amber-600 dark:text-amber-400">Sin mitigación definida.</p>}
              </div>
              <RemoveButton
                label={`Quitar riesgo ${risk.description}`}
                disabled={busy}
                onClick={() => onCommand({ kind: 'remove-risk', riskId: risk.id })}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[2fr_1fr_2fr_auto]">
        <Input aria-label="Riesgo" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Riesgo" />
        <select
          aria-label="Nivel del riesgo"
          value={level}
          onChange={(event) => setLevel(event.target.value as InitiativeRiskLevel)}
          className={selectClass}
        >
          {(Object.keys(RISK_LEVEL_LABELS) as InitiativeRiskLevel[]).map((value) => (
            <option key={value} value={value}>{RISK_LEVEL_LABELS[value]}</option>
          ))}
        </select>
        <Input aria-label="Mitigación" value={mitigation} onChange={(e) => setMitigation(e.target.value)} placeholder="Mitigación" />
        <Button variant="secondary" size="sm" onClick={addRisk} disabled={busy || !description.trim()}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </SectionCard>
  );
};

// ---------------------------------------------------------------------------
// Stakeholders
// ---------------------------------------------------------------------------

export const StakeholderPanel: React.FC<PanelProps> = ({ initiative, onCommand, busy, assist }) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [kind, setKind] = useState<InitiativeStakeholderKind>('stakeholder');

  const addStakeholder = useCallback(() => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCommand({ kind: 'add-stakeholder', name: trimmed, role, stakeholderKind: kind });
    setName(''); setRole(''); setKind('stakeholder');
  }, [name, role, kind, onCommand]);

  const hasSponsor = initiative.stakeholders.some((item) => item.kind === 'sponsor');

  return (
    <SectionCard
      id="personas"
      icon={INITIATIVE_SECTION_ICONS.people}
      title="Personas"
      action={assist && (
        <CaptureAssist
          fieldId="initiative.stakeholders"
          assistant={assist.assistant}
          context={assist.context}
          applied={initiative.stakeholders.map((stakeholder) => stakeholder.role)}
          apply={setRole}
        />
      )}
      hint="Quién patrocina la iniciativa, quién la posee en el negocio y quién lidera la arquitectura."
      count={initiative.stakeholders.length}
    >
      {!hasSponsor && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
          Sin patrocinador. Una iniciativa sin quien la respalde no se puede priorizar.
        </p>
      )}
      {initiative.stakeholders.length > 0 && (
        <ul className="space-y-1.5">
          {initiative.stakeholders.map((stakeholder) => (
            <li key={stakeholder.id} className="flex items-center gap-2 rounded-lg border border-gray-200 px-2.5 py-2 dark:border-gray-800">
              <Badge tone={stakeholder.kind === 'sponsor' ? 'primary' : 'gray'} size="xs">
                {STAKEHOLDER_KIND_LABELS[stakeholder.kind]}
              </Badge>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-gray-800 dark:text-gray-100">{stakeholder.name}</span>
                {stakeholder.role && (
                  <span className="text-2xs text-gray-500 dark:text-gray-400">{stakeholder.role}</span>
                )}
              </span>
              <RemoveButton
                label={`Quitar a ${stakeholder.name}`}
                disabled={busy}
                onClick={() => onCommand({ kind: 'remove-stakeholder', stakeholderId: stakeholder.id })}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-2 sm:grid-cols-[2fr_2fr_1fr_auto]">
        <Input aria-label="Nombre" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" />
        <Input aria-label="Cargo" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Cargo" />
        <select
          aria-label="Rol en la iniciativa"
          value={kind}
          onChange={(event) => setKind(event.target.value as InitiativeStakeholderKind)}
          className={selectClass}
        >
          {(Object.keys(STAKEHOLDER_KIND_LABELS) as InitiativeStakeholderKind[]).map((value) => (
            <option key={value} value={value}>{STAKEHOLDER_KIND_LABELS[value]}</option>
          ))}
        </select>
        <Button variant="secondary" size="sm" onClick={addStakeholder} disabled={busy || !name.trim()}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </SectionCard>
  );
};

/**
 * InitiativeRoom — the record of one business initiative.
 *
 * Structured as small complete areas rather than one long form, because the
 * questions the discipline asks are independent: motivation, outcomes,
 * indicators, milestones, risks, people, documents. A reader who only needs the
 * indicators should not have to scroll past the risks to reach them, so a
 * section rail jumps straight to each.
 *
 * The header answers "how is it going" without scrolling, and the attentions
 * area closes the loop downward: from the need to the architecture serving it.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useInitiatives } from '../context/InitiativeContext';
import { useToast } from '../context/ToastContext';
import {
  Alert, Badge, Button, Card, CardTitle, StatTile, cn,
} from '../components/ui';
import { Boxes, CalendarClock, Plus, Sparkles, Target, TrendingUp } from 'lucide-react';
import { HierarchyBreadcrumb, type HierarchyLevel } from '../components/navigation';
import {
  DocumentsPanel,
  InitiativeDeliveryPanel,
  InitiativeMotivationPanel,
  KpiPanel,
  MilestonePanel,
  OutcomesPanel,
  RiskPanel,
  StakeholderPanel,
  describeRemaining,
  formatDate,
  formatInvestment,
  HORIZON_LABELS,
  INITIATIVE_STATUS_HINTS,
  INITIATIVE_STATUS_ICONS,
  INITIATIVE_STATUS_LABELS,
  INITIATIVE_STATUS_TONES,
  INITIATIVE_HEALTH_LABELS,
  initiativeHealthVisual,
  PRIORITY_LABELS,
  PRIORITY_TONES,
} from '../components/businessInitiatives';
import { formatPercent } from '../components/architectureOffice/officeChartTokens';
import { EA_LEVELS } from '../lib/eaTerminology';
import { FormAssistBar } from '../components/capture';
import { useInitiativeRecordCapture } from '../hooks/useLevelCapture';
import { AssistantDock } from '../components/architectureOffice/AssistantDock';
import { AssistantLauncher } from '../components/architectureOffice/AssistantLauncher';
import {
  briefInitiativeInDepth,
  buildInitiativeScope,
} from '../services/architectureOffice/application/assistantConsultation';
import {
  assessCompleteness,
  daysRemaining,
  initiativeHealth,
  isClosedInitiative,
  kpiProgress,
  summarizeMilestones,
  type BusinessInitiative,
  type InitiativeHorizon,
  type InitiativePriority,
  type InitiativeStatus,
} from '../services/businessInitiatives';

const SECTIONS = [
  { id: 'motivacion', label: 'Motivación' },
  { id: 'objetivos', label: 'Objetivos' },
  { id: 'indicadores', label: 'Indicadores' },
  { id: 'hitos', label: 'Hitos' },
  { id: 'riesgos', label: 'Riesgos' },
  { id: 'personas', label: 'Personas' },
  { id: 'documentos', label: 'Documentos' },
  { id: 'proyectos', label: 'Proyectos' },
] as const;

const selectClass = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100';

const InitiativeRoom: React.FC = () => {
  const { initiativeId } = useParams<{ initiativeId: string }>();
  const navigate = useNavigate();
  const { projects, settings } = useAppContext();
  const { user, profile } = useAuth();
  const { initiatives, getInitiative, updateInitiative, deleteInitiative } = useInitiatives();
  const { addToast } = useToast();

  const [busy, setBusy] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const initiative = initiativeId ? getInitiative(initiativeId) : undefined;

  const attentions = useMemo(
    () => (initiative
      ? projects.filter((project) => (project.linkedBusinessProjects ?? []).includes(initiative.code))
      : []),
    [projects, initiative],
  );

  const patch = useCallback(async (
    changes: Partial<Omit<BusinessInitiative, 'id' | 'userId' | 'createdAt' | 'schemaVersion'>>,
  ) => {
    if (!initiativeId) return;
    setBusy(true);
    const result = await updateInitiative(initiativeId, changes);
    setBusy(false);
    if (!result.ok) addToast(result.reason ?? 'No se pudieron guardar los cambios.', 'error');
  }, [initiativeId, updateInitiative, addToast]);

  /**
   * What the office is told about this initiative. Only fields that are
   * actually filled in travel: an empty label ("Driver: ") reads to a model as
   * a driver that was considered and left blank, which is not what it means.
   */
  /*
   * La captura asistida de la ficha.
   *
   * Es el mismo arquitecto agente que ayuda al crear la iniciativa, con el
   * mismo catálogo de campos y la misma cuenta de lo que falta: mantener un
   * registro y crearlo son el mismo trabajo separado por semanas, y pedir ayuda
   * no puede funcionar distinto en cada momento. Un solo agente, sin
   * orquestación — el equipo completo sigue a un clic en el asistente, que es
   * donde una pregunta de arquitectura lo merece.
   */
  const capture = useInitiativeRecordCapture(initiative);

  const assistantScope = useMemo(
    () => (initiative
      ? buildInitiativeScope(initiative, briefInitiativeInDepth(initiative, attentions))
      : null),
    [initiative, attentions],
  );

  const levels = useMemo<HierarchyLevel[]>(() => {
    if (!initiative) return [];
    return [{
      kind: 'program' as const,
      label: initiative.code ? `${initiative.code} · ${initiative.title}` : initiative.title,
      currentId: initiative.id,
      siblings: initiatives.map((candidate) => ({
        id: candidate.id,
        label: candidate.title,
        hint: INITIATIVE_STATUS_LABELS[candidate.status],
        onSelect: () => navigate(`/initiatives/${candidate.id}`),
      })),
    }];
  }, [initiative, initiatives, navigate]);

  const handleDelete = useCallback(async () => {
    if (!initiativeId) return;
    setBusy(true);
    const result = await deleteInitiative(initiativeId);
    setBusy(false);
    if (!result.ok) {
      addToast(result.reason ?? 'No se pudo eliminar la iniciativa.', 'error');
      return;
    }
    addToast('Iniciativa eliminada.', 'info');
    navigate('/initiatives');
  }, [initiativeId, deleteInitiative, addToast, navigate]);

  if (!initiative) {
    return (
      <div className="min-h-[100dvh] px-4 py-6 md:pl-20 md:pr-8">
        <div className="mx-auto max-w-3xl">
          <Alert tone="warning" title="Iniciativa no encontrada">
            La iniciativa que buscas no existe o todavía no se ha cargado.
          </Alert>
          <Button className="mt-4" variant="secondary" onClick={() => navigate('/initiatives')}>
            Volver a {EA_LEVELS.initiative.plural.toLowerCase()}
          </Button>
        </div>
      </div>
    );
  }

  const health = initiativeHealth(initiative);
  const visual = initiativeHealthVisual(health);
  const StatusGlyph = INITIATIVE_STATUS_ICONS[initiative.status];
  const milestones = summarizeMilestones(initiative.milestones);
  const completeness = assessCompleteness(initiative);
  const remaining = isClosedInitiative(initiative.status)
    ? null
    : describeRemaining(daysRemaining(initiative.targetEndDate));

  const measurable = initiative.kpis
    .map(kpiProgress)
    .filter((value): value is number => value !== null);
  const attainment = measurable.length === 0
    ? null
    : measurable.reduce((sum, value) => sum + value, 0) / measurable.length;

  const addedBy = profile?.displayName || user?.email || 'Arquitecto';

  return (
    <div className="min-h-[100dvh] px-4 py-6 pb-24 md:pb-8 md:pl-20 md:pr-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <HierarchyBreadcrumb levels={levels} />

        <Card tone="gradient" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <span className={cn('inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl', visual.wash, visual.ink)}>
                <StatusGlyph className="h-6 w-6" aria-hidden strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-2xs font-semibold uppercase tracking-widest-2 text-primary-600 dark:text-primary-400">
                  {EA_LEVELS.initiative.singular}
                  {initiative.code && <span className="ml-2 font-mono">{initiative.code}</span>}
                </p>
                <h1 className="mt-0.5 text-xl font-bold leading-tight tracking-tight text-gray-900 dark:text-gray-50 md:text-2xl">
                  {initiative.title}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={INITIATIVE_STATUS_TONES[initiative.status]} size="xs">
                    {INITIATIVE_STATUS_LABELS[initiative.status]}
                  </Badge>
                  <Badge tone={PRIORITY_TONES[initiative.priority]} size="xs">
                    {PRIORITY_LABELS[initiative.priority]}
                  </Badge>
                  <Badge tone="gray" size="xs" outline>{HORIZON_LABELS[initiative.horizon]}</Badge>
                  <span className={cn('text-2xs font-medium', visual.ink)}>
                    {INITIATIVE_HEALTH_LABELS[health]}
                  </span>
                  {initiative.provenance === 'ai-assisted' && (
                    <Badge tone="ai" size="xs" outline>Estructurada con IA</Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Status, priority and horizon are the three fields a review
                changes most, so they are editable from the header. */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate(`/projects?iniciativa=${initiative.id}&crear=guiado`)}
              >
                <Plus className="mr-1.5 h-4 w-4" aria-hidden />
                Nuevo proyecto
              </Button>
              <Button variant="ai" size="sm" onClick={() => setAssistantOpen(true)}>
                <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
                Equipo de arquitectura
              </Button>
              <select
                aria-label="Estado de la iniciativa"
                value={initiative.status}
                onChange={(event) => patch({ status: event.target.value as InitiativeStatus })}
                className={selectClass}
                disabled={busy}
              >
                {(Object.keys(INITIATIVE_STATUS_LABELS) as InitiativeStatus[]).map((value) => (
                  <option key={value} value={value}>{INITIATIVE_STATUS_LABELS[value]}</option>
                ))}
              </select>
              <select
                aria-label="Prioridad"
                value={initiative.priority}
                onChange={(event) => patch({ priority: event.target.value as InitiativePriority })}
                className={selectClass}
                disabled={busy}
              >
                {(Object.keys(PRIORITY_LABELS) as InitiativePriority[]).map((value) => (
                  <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>
                ))}
              </select>
              <select
                aria-label="Horizonte"
                value={initiative.horizon}
                onChange={(event) => patch({ horizon: event.target.value as InitiativeHorizon })}
                className={selectClass}
                disabled={busy}
              >
                {(Object.keys(HORIZON_LABELS) as InitiativeHorizon[]).map((value) => (
                  <option key={value} value={value}>{HORIZON_LABELS[value]}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-gray-600 dark:text-gray-300">
            {INITIATIVE_STATUS_HINTS[initiative.status]}
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Ficha completa"
              value={formatPercent(completeness.ratio)}
              icon={Target}
              tone={completeness.ratio >= 1 ? 'success' : 'warning'}
              meter={completeness.ratio}
              hint={completeness.missing.length === 0
                ? 'Toda la información base está capturada'
                : `Falta: ${completeness.missing.slice(0, 2).join(', ')}`}
            />
            <StatTile
              label="Indicadores"
              value={attainment === null ? 'Sin medir' : formatPercent(attainment)}
              icon={TrendingUp}
              tone="primary"
              meter={attainment ?? undefined}
              hint={`${measurable.length}/${initiative.kpis.length} KPI con línea base y meta`}
            />
            <StatTile
              label="Hitos"
              value={milestones.total === 0 ? 'Sin hitos' : `${milestones.met}/${milestones.total}`}
              icon={CalendarClock}
              tone={milestones.missed > 0 ? 'danger' : 'neutral'}
              hint={milestones.next
                ? `Próximo: ${milestones.next.name} · ${formatDate(milestones.next.dueAt)}`
                : remaining?.text ?? `Objetivo: ${formatDate(initiative.targetEndDate)}`}
            />
            <StatTile
              label="Proyectos de arquitectura"
              value={attentions.length}
              icon={Boxes}
              tone="neutral"
              hint={attentions.length === 0
                ? 'Ningún proyecto responde todavía a esta iniciativa'
                : formatInvestment(initiative.estimatedInvestment, initiative.currency)}
            />
          </div>

          {remaining?.overdue && (
            <Alert tone="warning" role="status">
              {remaining.text}. La iniciativa se marca en riesgo automáticamente hasta que se
              actualice la fecha objetivo o se cierre.
            </Alert>
          )}
        </Card>

        <nav
          aria-label="Secciones de la iniciativa"
          className="sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto rounded-xl bg-white/85 px-1 py-1.5 backdrop-blur-md dark:bg-gray-950/85"
        >
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
            >
              {section.label}
            </a>
          ))}
        </nav>

        <FormAssistBar
          pendingCount={capture.pendingFields.length}
          onAsk={capture.askForm}
          loading={capture.formLoading}
          notice={capture.assistant.notice}
          openQuestions={capture.assistant.openQuestions}
          subject="la ficha de esta iniciativa"
        />

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <InitiativeMotivationPanel
              initiative={initiative}
              onPatch={patch}
              busy={busy}
              assist={capture.binding}
            />

            <OutcomesPanel initiative={initiative} onPatch={patch} busy={busy} assist={capture.binding} />
            <KpiPanel initiative={initiative} onPatch={patch} busy={busy} assist={capture.binding} />
            <MilestonePanel initiative={initiative} onPatch={patch} busy={busy} assist={capture.binding} />
          </div>

          <div className="space-y-5">
            <RiskPanel initiative={initiative} onPatch={patch} busy={busy} assist={capture.binding} />
            <StakeholderPanel initiative={initiative} onPatch={patch} busy={busy} assist={capture.binding} />
            <DocumentsPanel initiative={initiative} onPatch={patch} busy={busy} addedBy={addedBy} ownerId={user?.uid} />

            <InitiativeDeliveryPanel
              id="proyectos"
              initiative={initiative}
              initiatives={initiatives}
              projects={projects}
            />

            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>Eliminar iniciativa</CardTitle>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  Las proyectos de arquitectura enlazadas no se eliminan; quedan sin iniciativa.
                </p>
              </div>
              <Button variant="danger" size="sm" onClick={handleDelete} loading={busy}>
                Eliminar
              </Button>
            </Card>
          </div>
        </div>
      </div>

      {assistantScope && (
        <AssistantLauncher
          onOpen={() => setAssistantOpen(true)}
          label={`Abrir el equipo de arquitectura para ${initiative.title}`}
        />
      )}

      {assistantScope && (
        <AssistantDock
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          scope={assistantScope}
          settings={settings}
          suggestions={[
            'Evalúa si los indicadores miden de verdad el resultado esperado',
            '¿Qué proyectos de arquitectura necesita esta iniciativa?',
            'Identifica los riesgos regulatorios de esta necesidad',
          ]}
        />
      )}
    </div>
  );
};

export default InitiativeRoom;

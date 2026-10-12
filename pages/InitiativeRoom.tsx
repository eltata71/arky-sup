import { useUiTranslation } from '../lib/i18n/UiTranslationContext';
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
  type InitiativeCommand,
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
  const translateConfig = useUiTranslation();
  const t = useUiTranslation();
  const { initiativeId } = useParams<{ initiativeId: string }>();
  const navigate = useNavigate();
  const { projects, settings } = useAppContext();
  const { user, profile } = useAuth();
  const { initiatives, getInitiative, runInitiativeCommand, deleteInitiative } = useInitiatives();
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

  const run = useCallback(async (command: InitiativeCommand) => {
    if (!initiativeId) return;
    setBusy(true);
    const result = await runInitiativeCommand(initiativeId, command);
    setBusy(false);
    if (!result.ok) addToast(result.reason ?? t("uiMessage.no-se-pudieron-guardar-los-c.6b517c"), 'error');
  }, [initiativeId, runInitiativeCommand, addToast, t]);

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
      addToast(result.reason ?? t("uiMessage.no-se-pudo-eliminar-la-inici.f88316"), 'error');
      return;
    }
    addToast(t("uiMessage.iniciativa-eliminada.2b088b"), 'info');
    navigate('/initiatives');
  }, [initiativeId, deleteInitiative, addToast, navigate, t]);

  if (!initiative) {
    return (
      <div className="min-h-[100dvh] px-4 py-6 md:pl-20 md:pr-8">
        <div className="mx-auto max-w-3xl">
          <Alert tone="warning" title={t("ui.iniciativa-no-encontrada.3e6a04")}>
            {t("ui.la-iniciativa-que-buscas-no.f44f21")}
          </Alert>
          <Button className="mt-4" variant="secondary" onClick={() => navigate('/initiatives')}>
            {t("ui.volver-a.6258fc")} {EA_LEVELS.initiative.plural.toLowerCase()}
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
    : describeRemaining(daysRemaining(initiative.targetEndDate), t);

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
                    {translateConfig(INITIATIVE_STATUS_LABELS[initiative.status])}
                  </Badge>
                  <Badge tone={PRIORITY_TONES[initiative.priority]} size="xs">
                    {translateConfig(PRIORITY_LABELS[initiative.priority])}
                  </Badge>
                  <Badge tone="gray" size="xs" outline>{translateConfig(HORIZON_LABELS[initiative.horizon])}</Badge>
                  <span className={cn('text-2xs font-medium', visual.ink)}>
                    {translateConfig(INITIATIVE_HEALTH_LABELS[health])}
                  </span>
                  {initiative.provenance === 'ai-assisted' && (
                    <Badge tone="ai" size="xs" outline>{t("ui.estructurada-con-ia.9401ff")}</Badge>
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
                {t("ui.nuevo-proyecto.11536d")}
              </Button>
              <Button variant="ai" size="sm" onClick={() => setAssistantOpen(true)}>
                <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
                {t("projectHub.architectureTeam")}
              </Button>
              <select
                aria-label={t("ui.estado-de-la-iniciativa.14fd68")}
                value={initiative.status}
                onChange={(event) => run({ kind: 'reclassify', status: event.target.value as InitiativeStatus })}
                className={selectClass}
                disabled={busy}
              >
                {(Object.keys(INITIATIVE_STATUS_LABELS) as InitiativeStatus[]).map((value) => (
                  <option key={value} value={value}>{translateConfig(INITIATIVE_STATUS_LABELS[value])}</option>
                ))}
              </select>
              <select
                aria-label={t("mem.priority")}
                value={initiative.priority}
                onChange={(event) => run({ kind: 'reclassify', priority: event.target.value as InitiativePriority })}
                className={selectClass}
                disabled={busy}
              >
                {(Object.keys(PRIORITY_LABELS) as InitiativePriority[]).map((value) => (
                  <option key={value} value={value}>{translateConfig(PRIORITY_LABELS[value])}</option>
                ))}
              </select>
              <select
                aria-label={t("ui.horizonte.39643e")}
                value={initiative.horizon}
                onChange={(event) => run({ kind: 'reclassify', horizon: event.target.value as InitiativeHorizon })}
                className={selectClass}
                disabled={busy}
              >
                {(Object.keys(HORIZON_LABELS) as InitiativeHorizon[]).map((value) => (
                  <option key={value} value={value}>{translateConfig(HORIZON_LABELS[value])}</option>
                ))}
              </select>
            </div>
          </div>

          <p className="text-xs text-gray-600 dark:text-gray-300">
            {translateConfig(INITIATIVE_STATUS_HINTS[initiative.status])}
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label={t("ui.ficha-completa.ee7fdf")}
              value={formatPercent(completeness.ratio)}
              icon={Target}
              tone={completeness.ratio >= 1 ? 'success' : 'warning'}
              meter={completeness.ratio}
              hint={completeness.missing.length === 0
                ? 'Toda la información base está capturada'
                : `Falta: ${completeness.missing.slice(0, 2).join(', ')}`}
            />
            <StatTile
              label={t("ui.indicadores.6160df")}
              value={attainment === null ? 'Sin medir' : formatPercent(attainment)}
              icon={TrendingUp}
              tone="primary"
              meter={attainment ?? undefined}
              hint={t("uiDynamicGenerated.p0-p1-kpi-con-linea-base-y-m.905b41", { p0: String(measurable.length), p1: String(initiative.kpis.length) })}
            />
            <StatTile
              label={t("iniPanel.milestonesTitle")}
              value={milestones.total === 0 ? 'Sin hitos' : `${milestones.met}/${milestones.total}`}
              icon={CalendarClock}
              tone={milestones.missed > 0 ? 'danger' : 'neutral'}
              hint={milestones.next
                ? t("uiDynamicGenerated.proximo-p0-p1.2da506", { p0: String(milestones.next.name), p1: String(formatDate(milestones.next.dueAt)) })
                : remaining?.text ?? `Objetivo: ${formatDate(initiative.targetEndDate)}`}
            />
            <StatTile
              label={t("ui.proyectos-de-arquitectura.98ab45")}
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
              {remaining.text}{t("ui.la-iniciativa-se-marca-en-ri.1aecbb")}
            </Alert>
          )}
        </Card>

        <nav
          aria-label={t("ui.secciones-de-la-iniciativa.ce143a")}
          className="sticky top-0 z-20 -mx-1 flex gap-1 overflow-x-auto rounded-xl bg-white/85 px-1 py-1.5 backdrop-blur-md dark:bg-gray-950/85"
        >
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
            >
              {translateConfig(section.label)}
            </a>
          ))}
        </nav>

        <FormAssistBar
          pendingCount={capture.pendingFields.length}
          onAsk={capture.askForm}
          loading={capture.formLoading}
          notice={capture.assistant.notice}
          openQuestions={capture.assistant.openQuestions}
          subject={t("la ficha de esta iniciativa")}
        />

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-5">
            <InitiativeMotivationPanel
              initiative={initiative}
              onCommand={run}
              busy={busy}
              assist={capture.binding}
            />

            <OutcomesPanel initiative={initiative} onCommand={run} busy={busy} assist={capture.binding} />
            <KpiPanel initiative={initiative} onCommand={run} busy={busy} assist={capture.binding} />
            <MilestonePanel initiative={initiative} onCommand={run} busy={busy} assist={capture.binding} />
          </div>

          <div className="space-y-5">
            <RiskPanel initiative={initiative} onCommand={run} busy={busy} assist={capture.binding} />
            <StakeholderPanel initiative={initiative} onCommand={run} busy={busy} assist={capture.binding} />
            <DocumentsPanel initiative={initiative} onCommand={run} busy={busy} addedBy={addedBy} ownerId={user?.uid} />

            <InitiativeDeliveryPanel
              id="proyectos"
              initiative={initiative}
              initiatives={initiatives}
              projects={projects}
            />

            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle>{t("ui.eliminar-iniciativa.ef554d")}</CardTitle>
                <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                  {t("ui.las-proyectos-de-arquitectur.be287d")}
                </p>
              </div>
              <Button variant="danger" size="sm" onClick={handleDelete} loading={busy}>
                {t("delete")}
              </Button>
            </Card>
          </div>
        </div>
      </div>

      {assistantScope && (
        <AssistantLauncher
          onOpen={() => setAssistantOpen(true)}
          label={t("uiTemplate.abrir-el-equipo-de-arquitect.acac15", { p0: String(initiative.title) })}
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

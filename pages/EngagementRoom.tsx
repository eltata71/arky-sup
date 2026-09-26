/**
 * EngagementRoom — the working surface of a single engagement.
 *
 * Everything the office did is inspectable here: who produced each deliverable,
 * who reviewed it, what they found, which gates passed and on what evidence,
 * and what the board decided.
 *
 * The redesign keeps all of that on one page — an engagement is a single story
 * and hiding half of it behind tabs makes the governance harder to audit — but
 * gives the page a spine: a hierarchy breadcrumb that also switches between
 * sibling engagements and projects, a metrics strip that answers "how is this
 * going" without scrolling, and a section rail that jumps to the four parts.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useOffice } from '../context/OfficeContext';
import { useInitiatives } from '../context/InitiativeContext';
import { useToast } from '../context/ToastContext';
import { useAriaAnnouncer } from '../hooks/useAriaAnnouncer';
import { Alert, Badge, Button, Card, CardTitle, Spinner, StatTile, cn } from '../components/ui';
import { EngagementRoomFallback } from '../components/architectureOffice/EngagementRoomFallback';
import { FilePlus2, Layers, ListChecks, Play, ScrollText, Sparkles, Square } from 'lucide-react';
import { EngagementTaskBoard } from '../components/architectureOffice/EngagementTaskBoard';
import { OfficeTimeline } from '../components/architectureOffice/OfficeTimeline';
import { ArbDecisionPanel } from '../components/architectureOffice/ArbDecisionPanel';
import { PersonaChip } from '../components/architectureOffice/PersonaAvatar';
import { HierarchyBreadcrumb, type HierarchyLevel } from '../components/navigation/HierarchyBreadcrumb';
import {
  ENGAGEMENT_KIND_ICONS,
  ENGAGEMENT_STATUS_ICONS,
  GATE_STATUS_ICONS,
} from '../components/architectureOffice/officeUiIcons';
import { formatPercent, OFFICE_HEALTH_VISUALS } from '../components/architectureOffice/officeChartTokens';
import {
  ENGAGEMENT_KIND_LABELS,
  ENGAGEMENT_STATUS_LABELS,
  ENGAGEMENT_STATUS_TONES,
  GATE_STATUS_LABELS,
  GATE_STATUS_TONES,
} from '../components/architectureOffice/officeUiLabels';
import { OFFICE_AGENT_PERSONAS } from '../services/architectureOffice/domain/officeAgentPersonas';
import { AssistantDock } from '../components/architectureOffice/AssistantDock';
import { AssistantLauncher } from '../components/architectureOffice/AssistantLauncher';
import type { CoordinationScope } from '../services/architectureOffice/application/officeCoordination';
import {
  buildOfficePortfolio,
  healthBucketOf,
  UNASSIGNED_PROGRAM_NAME,
} from '../services/architectureOffice/domain/officePortfolio';
import {
  summarizeEngagementProgress,
  type OfficeArbVerdict,
} from '../services/architectureOffice/domain/OfficeTypes';

/** Anchors used by the section rail. */
const SECTIONS = [
  { id: 'charter', label: 'Charter' },
  { id: 'tablero', label: 'Tablero' },
  { id: 'comite', label: 'Comité' },
  { id: 'actividad', label: 'Actividad' },
] as const;

const EngagementRoom: React.FC = () => {
  const { engagementId } = useParams<{ engagementId: string }>();
  const navigate = useNavigate();
  const { projects, settings, isLoading: projectsLoading } = useAppContext();
  const {
    engagements,
    isResolving,
    runningEngagementIds,
    arbEligibility,
    loadEngagements,
    approveCharter,
    runEngagementNow,
    cancelRun,
    evaluateGates,
    decideEngagement,
  } = useOffice();
  const { addToast } = useToast();
  const { initiatives } = useInitiatives();
  const { announce } = useAriaAnnouncer();

  const [busy, setBusy] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  useEffect(() => {
    for (const project of projects) void loadEngagements(project.id);
  }, [projects, loadEngagements]);

  const engagement = useMemo(
    () => engagements.find((item) => item.id === engagementId),
    [engagements, engagementId],
  );

  const project = useMemo(
    () => projects.find((item) => item.id === engagement?.projectId),
    [projects, engagement],
  );

  const portfolio = useMemo(
    () => buildOfficePortfolio(projects, engagements, { initiatives }),
    [projects, engagements, initiatives],
  );

  /**
   * The deliverable's briefing, plus the two levels above it. A deliverable
   * asked about in isolation loses both the architecture it belongs to and the
   * business reason it exists for — which is the failure the hierarchy was
   * introduced to prevent, and it would surface here as confidently reasoned
   * advice about the wrong thing.
   */
  const assistantScope = useMemo<CoordinationScope | null>(() => {
    if (!engagement) return null;
    const charter = engagement.charter;
    const briefing = [
      `Brief: ${engagement.brief}`,
      `Tipo de encargo: ${ENGAGEMENT_KIND_LABELS[charter.kind]}`,
      `Estado: ${ENGAGEMENT_STATUS_LABELS[engagement.status]}`,
    ];
    if (charter.objectives.length > 0) briefing.push(`Objetivos: ${charter.objectives.join('; ')}`);
    if (charter.outOfScope.length > 0) briefing.push(`Fuera de alcance: ${charter.outOfScope.join('; ')}`);
    if (charter.deliverables.length > 0) {
      briefing.push(`Artefactos planificados: ${charter.deliverables.map((item) => `${item.templateName} (produce ${OFFICE_AGENT_PERSONAS[item.assigneeId].alias}, revisa ${OFFICE_AGENT_PERSONAS[item.reviewerId].alias})`).join('; ')}`);
    }

    const ancestry: NonNullable<CoordinationScope['ancestry']> = [];
    const owningInitiative = initiatives.find((candidate) => engagement.initiativeIds.includes(candidate.id));
    if (owningInitiative) {
      ancestry.push({ level: 'initiative', name: owningInitiative.title, summary: owningInitiative.need });
    }
    if (project) {
      ancestry.push({ level: 'project', name: project.name, summary: project.description });
    }

    return { level: 'deliverable', id: engagement.id, name: engagement.title, briefing, ancestry };
  }, [engagement, project, initiatives]);

  /**
   * The breadcrumb doubles as a lateral switcher, so siblings are gathered at
   * each level: the projects under the same business initiative, and the other
   * engagements of this project.
   */
  const levels = useMemo<HierarchyLevel[]>(() => {
    if (!engagement) return [];
    const program = portfolio.programs.find((candidate) => candidate.projects.some(
      (node) => node.projectId === engagement.projectId,
    ));
    const projectNode = program?.projects.find((node) => node.projectId === engagement.projectId);

    return [
      {
        kind: 'program' as const,
        label: program?.isUnassigned ? UNASSIGNED_PROGRAM_NAME : program?.name ?? UNASSIGNED_PROGRAM_NAME,
        onNavigate: () => navigate('/office'),
        currentId: program?.id,
        siblings: portfolio.programs.map((candidate) => ({
          id: candidate.id,
          label: candidate.isUnassigned ? UNASSIGNED_PROGRAM_NAME : candidate.name,
          hint: `${candidate.projects.length} proyecto(s) · ${candidate.rollup.engagements} entregable(s)`,
          onSelect: () => navigate('/office'),
        })),
      },
      {
        kind: 'project' as const,
        label: project?.name ?? 'Proyecto',
        onNavigate: () => navigate(`/workspace/${engagement.projectId}`),
        currentId: engagement.projectId,
        siblings: (program?.projects ?? []).map((node) => ({
          id: node.projectId,
          label: node.name,
          hint: `${node.engagements.length} entregable(s) · ${node.artifactCount} artefacto(s)`,
          onSelect: () => navigate(`/workspace/${node.projectId}`),
        })),
      },
      {
        kind: 'engagement' as const,
        label: engagement.title,
        currentId: engagement.id,
        siblings: (projectNode?.engagements ?? []).map((sibling) => ({
          id: sibling.id,
          label: sibling.title,
          hint: ENGAGEMENT_STATUS_LABELS[sibling.status],
          onSelect: () => navigate(`/office/${sibling.id}`),
        })),
      },
    ];
  }, [engagement, project, portfolio, navigate]);

  const running = engagementId ? runningEngagementIds.includes(engagementId) : false;

  const handleApprove = useCallback(async () => {
    if (!engagementId) return;
    setBusy(true);
    const result = await approveCharter(engagementId);
    setBusy(false);
    addToast(
      result.ok ? 'Charter aprobado.' : result.reason ?? 'No se pudo aprobar el charter.',
      result.ok ? 'success' : 'error',
    );
  }, [engagementId, approveCharter, addToast]);

  const handleRun = useCallback(async () => {
    if (!engagementId) return;
    announce('La Oficina comenzó a ejecutar el entregable.');
    const result = await runEngagementNow(engagementId);
    addToast(result.reason ?? 'Ejecución finalizada.', result.ok ? 'info' : 'warning');
    announce(result.reason ?? 'Ejecución finalizada.');
  }, [engagementId, runEngagementNow, addToast, announce]);

  const handleEvaluateGates = useCallback(async () => {
    if (!engagementId) return;
    setBusy(true);
    const result = await evaluateGates(engagementId);
    setBusy(false);
    if (!result.ok) addToast(result.reason ?? 'No se pudieron evaluar los gates.', 'error');
  }, [engagementId, evaluateGates, addToast]);

  const handleDecide = useCallback(async (verdict: OfficeArbVerdict, rationale: string) => {
    if (!engagementId) return;
    setBusy(true);
    const result = await decideEngagement(engagementId, verdict, rationale);
    setBusy(false);
    addToast(
      result.ok ? 'Decisión del comité registrada.' : result.reason ?? 'No se pudo registrar la decisión.',
      result.ok ? 'success' : 'error',
    );
  }, [engagementId, decideEngagement, addToast]);

  const openArtifact = useCallback((artifactId: string) => {
    if (!engagement) return;
    navigate(`/workspace/${engagement.projectId}?artifact=${artifactId}`);
  }, [engagement, navigate]);

  if (!engagement) {
    return (
      <EngagementRoomFallback
        resolving={projectsLoading || isResolving}
        onBack={() => navigate('/office')}
      />
    );
  }

  const progress = summarizeEngagementProgress(engagement.tasks);
  const charterApproved = Boolean(engagement.charter.approvedAt);
  const bucket = healthBucketOf(engagement.status);
  const visual = OFFICE_HEALTH_VISUALS[bucket];
  const StatusGlyph = ENGAGEMENT_STATUS_ICONS[engagement.status];
  const KindGlyph = ENGAGEMENT_KIND_ICONS[engagement.charter.kind];
  const gateStatus = engagement.gateAssessment?.overallStatus;
  const GateGlyph = gateStatus ? GATE_STATUS_ICONS[gateStatus] : undefined;
  const artifactsProduced = engagement.tasks.filter((task) => task.producedArtifactId).length;
  const budgetRatio = engagement.budget.maxAiCalls === 0
    ? 0
    : engagement.budget.consumedAiCalls / engagement.budget.maxAiCalls;

  return (
    <div className="min-h-[100dvh] px-4 py-6 pb-24 md:pb-8 md:pl-20 md:pr-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <HierarchyBreadcrumb levels={levels} />

        {/* Hero — identity, state and the one action that moves the engagement. */}
        <Card tone="gradient" className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <span
                className={cn(
                  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl',
                  visual.wash,
                  visual.ink,
                )}
              >
                <StatusGlyph className="h-6 w-6" aria-hidden strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-bold leading-tight tracking-tight text-gray-900 dark:text-gray-50 md:text-2xl">
                  {engagement.title}
                </h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Badge tone={ENGAGEMENT_STATUS_TONES[engagement.status]} size="xs">
                    {ENGAGEMENT_STATUS_LABELS[engagement.status]}
                  </Badge>
                  <Badge tone="gray" size="xs" outline>
                    <KindGlyph className="mr-1 h-3 w-3" aria-hidden />
                    {ENGAGEMENT_KIND_LABELS[engagement.charter.kind]}
                  </Badge>
                  {gateStatus && GateGlyph && (
                    <Badge tone={GATE_STATUS_TONES[gateStatus]} size="xs">
                      <GateGlyph className="mr-1 h-3 w-3" aria-hidden />
                      Gates: {GATE_STATUS_LABELS[gateStatus]}
                    </Badge>
                  )}
                  {running && <Badge tone="primary" size="xs" dot>En ejecución</Badge>}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* The level below a deliverable is the artifact, and the
                  workspace is where artifacts are produced — so this hands the
                  user to it with the project already open rather than making
                  them find it through the rail. */}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/workspace/${engagement.projectId}?crear=artefacto`)}
              >
                <FilePlus2 className="mr-1.5 h-4 w-4" aria-hidden />
                Nuevo artefacto
              </Button>
              <Button variant="ai" size="sm" onClick={() => setAssistantOpen(true)}>
                <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
                Equipo de arquitectura
              </Button>
              {!charterApproved && (
                <Button variant="primary" size="sm" onClick={handleApprove} loading={busy}>
                  <ScrollText className="mr-1.5 h-4 w-4" aria-hidden />
                  Aprobar charter
                </Button>
              )}
              {charterApproved && !running && engagement.status !== 'delivered' && (
                <Button variant="primary" size="sm" onClick={handleRun}>
                  <Play className="mr-1.5 h-4 w-4" aria-hidden />
                  {progress.completed > 0 ? 'Reanudar ejecución' : 'Ejecutar entregable'}
                </Button>
              )}
              {running && (
                <Button variant="secondary" size="sm" onClick={() => cancelRun(engagement.id)}>
                  <Square className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  Detener
                </Button>
              )}
            </div>
          </div>

          {/* The four numbers that say how the engagement is going. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Avance"
              value={formatPercent(progress.ratio)}
              icon={ListChecks}
              tone={progress.failed > 0 ? 'warning' : 'primary'}
              meter={progress.ratio}
              hint={`${progress.completed}/${progress.total} tareas${progress.failed > 0 ? ` · ${progress.failed} con problemas` : ''}`}
            />
            <StatTile
              label="Artefactos"
              value={artifactsProduced}
              icon={Layers}
              tone="neutral"
              hint={`${engagement.charter.deliverables.length} artefacto(s) planificado(s)`}
            />
            <StatTile
              label="Presupuesto de IA"
              value={`${engagement.budget.consumedAiCalls}/${engagement.budget.maxAiCalls}`}
              icon={Sparkles}
              tone="ai"
              meter={budgetRatio}
              hint={`${formatPercent(budgetRatio)} del presupuesto usado`}
            />
            <StatTile
              label="Gates"
              value={gateStatus ? GATE_STATUS_LABELS[gateStatus] : 'Sin evaluar'}
              icon={GateGlyph ?? GATE_STATUS_ICONS.conditional}
              tone={gateStatus === 'blocked' ? 'danger' : gateStatus === 'pass' ? 'success' : 'warning'}
              hint={`${engagement.gateAssessment?.gates.length ?? 0} gate(s) de calidad`}
            />
          </div>

          {running && (
            <Alert tone="info" role="status">
              <span className="inline-flex items-center gap-2">
                <Spinner />
                La Oficina está ejecutando el entregable. Puedes cerrar esta pestaña: el progreso se guarda
                en cada tarea y se reanuda al volver.
              </span>
            </Alert>
          )}
        </Card>

        {/* Section rail — the page stays whole, but is no longer a long scroll
            you have to hunt through on a tablet. */}
        <nav
          aria-label="Secciones del entregable"
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

        <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <Card id="charter" className="scroll-mt-16 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Charter</CardTitle>
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone="gray" size="xs" outline>
                    {engagement.charter.provenance === 'ai-refined' ? 'Refinado con IA' : 'Determinista'}
                  </Badge>
                  {engagement.charter.approvedBy && (
                    <Badge tone="success" size="xs">
                      Aprobado por {engagement.charter.approvedBy.name}
                    </Badge>
                  )}
                </div>
              </div>

              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300">{engagement.brief}</p>

              {engagement.charter.objectives.length > 0 && (
                <div>
                  <h3 className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
                    Objetivos
                  </h3>
                  <ul className="mt-1.5 space-y-1">
                    {engagement.charter.objectives.map((objective) => (
                      <li key={objective} className="flex gap-2 text-sm text-gray-600 dark:text-gray-300">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" aria-hidden />
                        <span className="leading-relaxed">{objective}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h3 className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
                  Equipo asignado
                </h3>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {engagement.charter.participantIds.map((personaId) => (
                    <PersonaChip key={personaId} personaId={personaId} />
                  ))}
                </div>
              </div>

              {engagement.charter.regulatoryDrivers.length > 0 && (
                <div>
                  <h3 className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
                    Marco regulatorio
                  </h3>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {engagement.charter.regulatoryDrivers.map((driver) => (
                      <Badge key={driver} tone="warning" size="xs" outline className="max-w-full whitespace-normal text-left">
                        {driver}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {engagement.businessProjectIds.length > 0 && (
                <div>
                  <h3 className="text-2xs font-semibold uppercase tracking-widest-2 text-gray-500 dark:text-gray-400">
                    Iniciativas de negocio
                  </h3>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {engagement.businessProjectIds.map((id) => (
                      <Badge key={id} tone="info" size="xs">{id}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </Card>

            <section id="tablero" className="scroll-mt-16 space-y-3" aria-label="Tablero del entregable">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Tablero de trabajo
                </h2>
                <span className="text-2xs text-gray-400 dark:text-gray-500">
                  {progress.total} tarea(s) · {Object.keys(OFFICE_AGENT_PERSONAS).length} especialistas disponibles
                </span>
              </div>
              <EngagementTaskBoard tasks={engagement.tasks} onOpenArtifact={openArtifact} />
            </section>
          </div>

          <div className="space-y-5">
            <div id="comite" className="scroll-mt-16">
              <ArbDecisionPanel
                engagement={engagement}
                eligibility={arbEligibility(engagement)}
                busy={busy}
                onDecide={handleDecide}
                onReevaluateGates={handleEvaluateGates}
              />
            </div>

            <Card id="actividad" className="scroll-mt-16 space-y-3">
              <CardTitle>Actividad de la Oficina</CardTitle>
              <OfficeTimeline projectId={engagement.projectId} entries={engagement.auditTrail} />
            </Card>
          </div>
        </div>
      </div>

      {assistantScope && (
        <AssistantLauncher
          onOpen={() => setAssistantOpen(true)}
          label={`Abrir el equipo de arquitectura para ${engagement.title}`}
        />
      )}

      {assistantScope && (
        <AssistantDock
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          scope={assistantScope}
          settings={settings}
          project={project}
          suggestions={[
            'Revisa si el plan de artefactos cubre lo que pide el brief',
            '¿Qué riesgos ves en este entregable antes de llevarlo al comité?',
            'Explica los hallazgos abiertos y qué haría falta para cerrarlos',
          ]}
        />
      )}
    </div>
  );
};

export default EngagementRoom;

/**
 * OfficePage — the front door of the product.
 *
 * The office has three nested levels and the old console only showed the
 * innermost one, as a flat grid of engagement cards. This page answers the
 * portfolio questions first and drills down on demand:
 *
 *   1. What is waiting on me right now?              → the decision queue
 *   2. How is the whole portfolio doing?             → the KPI row and pulse
 *   3. Where does a given piece of work live?        → the hierarchy explorer
 *   4. Who is carrying the load?                     → the specialist panel
 *
 * The hierarchy itself (negocio › arquitectura › entregable) is derived in
 * `services/architectureOffice/officePortfolio`; this component only lays it
 * out. Nothing here changes how an engagement is created, run or governed.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useOffice } from '../context/OfficeContext';
import { useInitiatives } from '../context/InitiativeContext';
import { useToast } from '../context/ToastContext';
import { Button, PageSkeleton, Tab, TabList, TabPanel, Tabs } from '../components/ui';
import { Activity, LayoutDashboard, LayoutGrid, Network, Plus, Users } from 'lucide-react';
import {
  EngagementIntakeWizard,
  type EngagementIntakeSubmit,
} from '../components/architectureOffice/EngagementIntakeWizard';
import {
  DecisionQueue,
  OfficeKpiRow,
  PortfolioExplorer,
  PortfolioPulse,
  SpecialistLoadPanel,
} from '../components/architectureOffice/dashboard';
import { BrokenLinksPanel, PortfolioCanvas, PortfolioSearchBox } from '../components/navigation';
import { resolvePortfolioGraph, type PortfolioSearchHit } from '../services/portfolioGraph';
import { OFFICE_AGENT_PERSONAS } from '../services/architectureOffice/domain/officeAgentPersonas';
import { buildOfficePortfolio } from '../services/architectureOffice/domain/officePortfolio';

type OfficeTabId = 'resumen' | 'portafolio' | 'canvas' | 'especialistas';

const DECISION_QUEUE_ID = 'oficina-decisiones';

const OfficePage: React.FC = () => {
  const navigate = useNavigate();
  const { projects, isLoading: projectsLoading } = useAppContext();
  const {
    engagements,
    runningEngagementIds,
    isLoading,
    canApprove,
    loadEngagements,
    createEngagement,
    approveCharter,
    runEngagementNow,
  } = useOffice();
  const { addToast } = useToast();
  const { initiatives } = useInitiatives();

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [tab, setTab] = useState<OfficeTabId>('resumen');

  // Engagements live under their project, so the console has to ask each
  // project for its own. `loadEngagements` is idempotent per project id.
  useEffect(() => {
    for (const project of projects) void loadEngagements(project.id);
  }, [projects, loadEngagements]);

  const portfolio = useMemo(
    () => buildOfficePortfolio(projects, engagements, { initiatives }),
    [projects, engagements, initiatives],
  );

  /**
   * The keyed graph backs search and the referential-integrity panel. Built
   * beside the portfolio rather than inside it: the portfolio answers "how is
   * it going", the graph answers "how does it relate".
   */
  const graph = useMemo(
    () => resolvePortfolioGraph(initiatives, projects, engagements),
    [initiatives, projects, engagements],
  );

  const handlePropose = useCallback(async (input: EngagementIntakeSubmit) => {
    const result = await createEngagement(input);
    if (!result.ok) {
      addToast(result.reason ?? 'No se pudo crear el entregable.', 'error');
      return null;
    }
    return result.engagement ?? null;
  }, [createEngagement, addToast]);

  const handleApproveAndRun = useCallback(async (engagementId: string) => {
    const approved = await approveCharter(engagementId);
    if (!approved.ok) {
      addToast(approved.reason ?? 'No se pudo aprobar el charter.', 'error');
      return;
    }
    addToast('Charter aprobado. La Oficina está ejecutando el entregable.', 'success');
    const run = await runEngagementNow(engagementId);
    addToast(run.reason ?? 'Ejecución finalizada.', run.ok ? 'info' : 'warning');
  }, [approveCharter, runEngagementNow, addToast]);

  const openIntake = useCallback(() => setIntakeOpen(true), []);
  const openEngagement = useCallback(
    (engagementId: string) => navigate(`/office/${engagementId}`),
    [navigate],
  );
  const openProject = useCallback(
    (projectId: string) => navigate(`/workspace/${projectId}`),
    [navigate],
  );

  /** Search navigates by id, so a hit never has to be re-matched by name. */
  const openSearchHit = useCallback((hit: PortfolioSearchHit) => {
    if (hit.level === 'initiative') navigate(`/initiatives/${hit.id}`);
    else if (hit.level === 'attention') navigate(`/workspace/${hit.id}`);
    else if (hit.level === 'deliverable') navigate(`/office/${hit.id}`);
    else if (hit.path.attention) navigate(`/workspace/${hit.path.attention.id}?artifact=${hit.id}`);
  }, [navigate]);

  /** The KPI tile for pending decisions jumps to the queue instead of filtering. */
  const focusDecisions = useCallback(() => {
    setTab('resumen');
    requestAnimationFrame(() => {
      document.getElementById(DECISION_QUEUE_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  if (projectsLoading || isLoading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
        <PageSkeleton label="Cargando el tablero de la Oficina" tiles={4} panels={2} />
      </div>
    );
  }

  const programCount = portfolio.programs.filter((program) => !program.isUnassigned).length;

  return (
    <div className="min-h-[100dvh] bg-mesh-light px-4 py-6 pb-24 dark:bg-mesh-dark md:pb-8 md:pl-20 md:pr-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-widest-2 text-primary-600 dark:text-primary-400">
              Oficina de Arquitectura Empresarial
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50 md:text-display-sm">
              Panel de la Oficina
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {programCount} iniciativa(s) de negocio · {portfolio.projects.length} proyecto(s) de
              arquitectura · {portfolio.rollup.engagements} entregable(s) ·{' '}
              {Object.keys(OFFICE_AGENT_PERSONAS).length} especialistas
            </p>
          </div>
          <Button variant="primary" onClick={openIntake}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Nuevo entregable
          </Button>
        </header>

        <PortfolioSearchBox graph={graph} onSelect={openSearchHit} />

        <OfficeKpiRow
          rollup={portfolio.rollup}
          projectCount={portfolio.projects.length}
          onFocusDecisions={focusDecisions}
        />

        <Tabs
          value={tab}
          onChange={(next) => setTab(next as OfficeTabId)}
          variant="pill"
          aria-label="Vistas de la Oficina"
        >
          <TabList className="w-full overflow-x-auto sm:w-auto">
            <Tab value="resumen" icon={<LayoutDashboard className="h-4 w-4" aria-hidden />}>
              Resumen
            </Tab>
            <Tab
              value="portafolio"
              icon={<Network className="h-4 w-4" aria-hidden />}
              badge={portfolio.rollup.engagements || undefined}
            >
              Portafolio
            </Tab>
            <Tab value="canvas" icon={<LayoutGrid className="h-4 w-4" aria-hidden />}>
              Canvas
            </Tab>
            <Tab value="especialistas" icon={<Users className="h-4 w-4" aria-hidden />}>
              Especialistas
            </Tab>
          </TabList>

          <TabPanel value="resumen" className="space-y-4 pt-4">
            <DecisionQueue
              id={DECISION_QUEUE_ID}
              items={portfolio.decisionQueue}
              canApprove={canApprove}
              onOpen={openEngagement}
            />
            <PortfolioPulse rollup={portfolio.rollup} activity={portfolio.activity} />
            <BrokenLinksPanel
              issues={graph.issues}
              onOpen={(issue) => {
                if (issue.level === 'deliverable') navigate(`/office/${issue.sourceId}`);
                else if (issue.level === 'attention') navigate(`/workspace/${issue.sourceId}`);
                else navigate(`/initiatives/${issue.sourceId}`);
              }}
            />
          </TabPanel>

          <TabPanel value="portafolio" className="pt-4">
            <PortfolioExplorer
              programs={portfolio.programs}
              runningEngagementIds={runningEngagementIds}
              onOpenEngagement={openEngagement}
              onOpenProject={openProject}
              onNewEngagement={openIntake}
            />
          </TabPanel>

          <TabPanel value="canvas" className="pt-4">
            <PortfolioCanvas
              initiatives={initiatives}
              attentions={portfolio.projects}
              onOpenInitiative={(id) => navigate(`/initiatives/${id}`)}
              onOpenAttention={openProject}
              onOpenDeliverable={openEngagement}
            />
          </TabPanel>

          <TabPanel value="especialistas" className="space-y-3 pt-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
              <Activity className="h-4 w-4" aria-hidden />
              Carga real de los especialistas, calculada sobre las tareas del DAG de cada entregable.
            </div>
            <SpecialistLoadPanel specialists={portfolio.specialists} />
          </TabPanel>
        </Tabs>
      </div>

      <EngagementIntakeWizard
        open={intakeOpen}
        projects={projects.map((project) => ({
          id: project.id,
          name: project.name,
          initiativeIds: project.initiativeIds ?? [],
        }))}
        initiatives={initiatives}
        onCreateAttention={() => navigate('/projects')}
        onCreateInitiative={() => navigate('/initiatives')}
        onPropose={handlePropose}
        onApproveAndRun={handleApproveAndRun}
        onClose={() => setIntakeOpen(false)}
      />
    </div>
  );
};

export default OfficePage;

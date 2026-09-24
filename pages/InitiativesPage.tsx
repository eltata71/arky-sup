/**
 * InitiativesPage — management of business initiatives, the top of the
 * hierarchy.
 *
 * Laid out to answer the same four questions, in the same order, as the Office
 * console does one level down — so an architect who learned that board can read
 * this one without relearning anything:
 *
 *   1. How is the initiative portfolio doing?   → the KPI row
 *   2. What is waiting on a decision?           → the attention list
 *   3. How is it distributed and where is risk? → the pulse
 *   4. Where does a given need live?            → the initiative list
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useInitiatives } from '../context/InitiativeContext';
import { useToast } from '../context/ToastContext';
import { Button, EmptyState, Input, PageSkeleton, Tab, TabList, TabPanel, Tabs, cn } from '../components/ui';
import { LayoutDashboard, ListFilter, Plus, Search, Sparkles, SquarePen, Trash2 } from 'lucide-react';
import {
  InitiativeCard,
  InitiativeIntakeWizard,
  InitiativeKpiRow,
  InitiativePulse,
  INITIATIVE_STATUS_LABELS,
  type InitiativeIntakeSubmit,
} from '../components/businessInitiatives';
import { EA_LEVELS } from '../lib/eaTerminology';
import { AssistantDock } from '../components/architectureOffice/AssistantDock';
import { useInitiativeBoard } from '../hooks/useInitiativeBoard';
import { useInitiativeAssistant } from '../hooks/useInitiativeAssistant';
import type { BusinessInitiative, InitiativeStatus } from '../context/InitiativeContext';

type ViewId = 'resumen' | 'listado';

const STATUS_FILTERS: (InitiativeStatus | 'all')[] = [
  'all', 'draft', 'proposed', 'approved', 'in-progress', 'on-hold', 'delivered', 'realized',
];

const InitiativesPage: React.FC = () => {
  const navigate = useNavigate();
  const { projects, settings } = useAppContext();
  const {
    initiatives,
    isLoading,
    usedCodes,
    createInitiative,
    runInitiativeCommand,
    deleteInitiative,
  } = useInitiatives();
  const { addToast } = useToast();

  const [intakeOpen, setIntakeOpen] = useState(false);
  const [assistantFor, setAssistantFor] = useState<BusinessInitiative | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BusinessInitiative | null>(null);
  const [view, setView] = useState<ViewId>('resumen');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<InitiativeStatus | 'all'>('all');

  /**
   * The rollup and how many attentions serve each initiative, resolved by key
   * in `useInitiativeBoard` — never by the `NEG-YYYY-NNN` mirror.
   */
  const { rollup, attentionsById, attentionCount } = useInitiativeBoard(initiatives, projects);
  const assistant = useInitiativeAssistant(settings);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return initiatives.filter((initiative) => {
      if (statusFilter !== 'all' && initiative.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        initiative.title.toLowerCase().includes(needle)
        || initiative.code.toLowerCase().includes(needle)
        || initiative.need.toLowerCase().includes(needle)
        || initiative.driver.toLowerCase().includes(needle)
      );
    });
  }, [initiatives, query, statusFilter]);

  /**
   * Creating and then enriching is two writes rather than one, on purpose: the
   * initiative must exist even if the enrichment fails, and the assistant's
   * proposal is additive to a record the user can already see.
   */
  const handleSubmit = useCallback(async (input: InitiativeIntakeSubmit) => {
    const created = await createInitiative({
      title: input.title,
      need: input.need,
      driver: input.driver,
      objectives: input.objectives,
      priority: input.priority,
      horizon: input.horizon,
      startDate: input.startDate,
      targetEndDate: input.targetEndDate,
      provenance: input.draft ? 'ai-assisted' : 'manual',
    });
    if (!created.ok || !created.initiative) {
      return { ok: false, reason: created.reason };
    }

    const draft = input.draft;
    if (draft) {
      await runInitiativeCommand(created.initiative.id, {
        kind: 'adopt-intake-draft',
        outcomes: draft.outcomes,
        kpis: draft.kpis,
        risks: draft.risks,
        affectedCapabilities: draft.affectedCapabilities,
        regulatoryDrivers: draft.regulatoryDrivers,
        openQuestions: draft.openQuestions,
      });
    }

    addToast('Iniciativa de negocio creada.', 'success');
    navigate(`/initiatives/${created.initiative.id}`);
    return { ok: true };
  }, [createInitiative, runInitiativeCommand, addToast, navigate]);

  const openInitiative = useCallback(
    (initiative: BusinessInitiative) => navigate(`/initiatives/${initiative.id}`),
    [navigate],
  );

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    const result = await deleteInitiative(pendingDelete.id);
    setPendingDelete(null);
    addToast(
      result.ok ? 'Iniciativa eliminada.' : (result.reason ?? 'No se pudo eliminar la iniciativa.'),
      result.ok ? 'success' : 'error',
    );
  }, [pendingDelete, deleteInitiative, addToast]);

  useEffect(() => {
    // A filter that hides everything reads as "no data" — reset it instead.
    if (statusFilter !== 'all' && visible.length === 0 && initiatives.length > 0) {
      setView('listado');
    }
  }, [statusFilter, visible.length, initiatives.length]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-8">
        <PageSkeleton label="Cargando las iniciativas de negocio" tiles={4} panels={2} />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-mesh-light px-4 py-6 pb-24 dark:bg-mesh-dark md:pb-8 md:pl-20 md:pr-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-widest-2 text-primary-600 dark:text-primary-400">
              Arquitectura Empresarial · capa de motivación
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-50 md:text-display-sm">
              {EA_LEVELS.initiative.plural}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
              {EA_LEVELS.initiative.definition}
            </p>
          </div>
          <Button variant="primary" onClick={() => setIntakeOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
            Nueva iniciativa
          </Button>
        </header>

        {initiatives.length === 0 ? (
          <EmptyState
            title="Todavía no hay iniciativas de negocio"
            description="Registra la primera necesidad del negocio. El asistente propondrá su driver, objetivos, resultados e indicadores, y desde ahí podrás abrir las proyectos de arquitectura que la sirvan."
            actions={<Button variant="primary" onClick={() => setIntakeOpen(true)}>Nueva iniciativa</Button>}
            flavor="ai"
          />
        ) : (
          <>
            <InitiativeKpiRow
              rollup={rollup}
              attentionCount={attentionCount}
              currency={initiatives.find((item) => item.currency)?.currency}
              onFocusDecisions={() => {
                setView('listado');
                setStatusFilter('proposed');
              }}
            />

            <Tabs
              value={view}
              onChange={(next) => setView(next as ViewId)}
              variant="pill"
              aria-label="Vistas de iniciativas"
            >
              <TabList className="w-full overflow-x-auto sm:w-auto">
                <Tab value="resumen" icon={<LayoutDashboard className="h-4 w-4" aria-hidden />}>
                  Resumen
                </Tab>
                <Tab
                  value="listado"
                  icon={<ListFilter className="h-4 w-4" aria-hidden />}
                  badge={initiatives.length}
                >
                  Listado
                </Tab>
              </TabList>

              <TabPanel value="resumen" className="pt-4">
                <InitiativePulse initiatives={initiatives} rollup={rollup} />
              </TabPanel>

              <TabPanel value="listado" className="space-y-3 pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-0 flex-1 sm:max-w-xs">
                    <Search
                      className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                      aria-hidden
                    />
                    <Input
                      aria-label="Buscar por título, código o necesidad"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Buscar por título, código o necesidad"
                      className="pl-8"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {STATUS_FILTERS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setStatusFilter(value)}
                        aria-pressed={statusFilter === value}
                        className={cn(
                          'rounded-lg px-2.5 py-1 text-2xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                          statusFilter === value
                            ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-200'
                            : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
                        )}
                      >
                        {value === 'all' ? 'Todas' : INITIATIVE_STATUS_LABELS[value]}
                      </button>
                    ))}
                  </div>
                </div>

                {visible.length === 0 ? (
                  <p className="rounded-xl bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:bg-gray-900/50 dark:text-gray-400">
                    Ninguna iniciativa coincide con el filtro.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {visible.map((initiative) => (
                      <InitiativeCard
                        key={initiative.id}
                        initiative={initiative}
                        attentionCount={attentionsById.get(initiative.id) ?? 0}
                        onOpen={() => openInitiative(initiative)}
                        actions={[
                          {
                            id: 'assistant',
                            label: 'Conversar con el equipo de arquitectura',
                            icon: <Sparkles className="h-3.5 w-3.5" aria-hidden />,
                            onSelect: () => setAssistantFor(initiative),
                          },
                          {
                            id: 'open',
                            label: 'Abrir y gestionar la ficha',
                            icon: <SquarePen className="h-3.5 w-3.5" aria-hidden />,
                            onSelect: () => openInitiative(initiative),
                          },
                          {
                            id: 'delete',
                            label: 'Eliminar iniciativa',
                            icon: <Trash2 className="h-3.5 w-3.5" aria-hidden />,
                            onSelect: () => setPendingDelete(initiative),
                            destructive: true,
                          },
                        ]}
                      />
                    ))}
                  </div>
                )}
              </TabPanel>
            </Tabs>
          </>
        )}
      </div>

      {assistantFor && (
        <AssistantDock
          open
          onClose={() => setAssistantFor(null)}
          scope={assistant.scopeFor(assistantFor)}
          settings={settings}
          suggestions={[
            'Evalúa si los indicadores miden de verdad el resultado esperado',
            '¿Qué proyectos de arquitectura necesita esta iniciativa?',
            'Identifica los riesgos regulatorios de esta necesidad',
          ]}
        />
      )}

      {/* Deleting is irreversible and the card menu is one click away from the
          list, so the confirmation names what is about to be lost. */}
      {pendingDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar eliminación"
          className="fixed inset-0 z-[130] flex items-center justify-center bg-gray-950/50 p-4 backdrop-blur-sm"
          onClick={() => setPendingDelete(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-pop dark:bg-gray-900"
          >
            <h2 className="text-base font-bold text-gray-900 dark:text-gray-50">
              ¿Eliminar «{pendingDelete.title}»?
            </h2>
            <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-300">
              Los proyectos de arquitectura enlazados no se eliminan: quedan sin iniciativa y el
              tablero los reportará como tales.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPendingDelete(null)}>Cancelar</Button>
              <Button variant="danger" onClick={() => void confirmDelete()}>Eliminar</Button>
            </div>
          </div>
        </div>
      )}

      <InitiativeIntakeWizard
        open={intakeOpen}
        usedCodes={usedCodes}
        onDraft={assistant.draft}
        onSubmit={handleSubmit}
        onClose={() => setIntakeOpen(false)}
      />
    </div>
  );
};

export default InitiativesPage;

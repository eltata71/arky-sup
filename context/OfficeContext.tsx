/**
 * OfficeContext — state and operations of the Architecture Office.
 *
 * Deliberately **not** part of `AppContext`: that file is at 833 lines and 31
 * members, and `CLAUDE.md` names it as at its practical ceiling. The office is
 * a separate bounded context, so it gets its own provider mounted inside
 * `AppContextProvider` (it reads projects and the artifact store from there).
 *
 * The provider owns the lifecycle only; the planning, execution and governance
 * rules all live in `services/architectureOffice/` as pure functions.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAppContext } from './AppContext';
import { useAuth } from './AuthContext';
import {
  officeEngagementRepository,
} from '../services/architectureOffice/OfficeEngagementRepository';
import {
  approveCharterOperation,
  createEngagementOperation,
  decideEngagementOperation,
  deleteEngagementOperation,
  evaluateGatesOperation,
  type CreateEngagementCommand,
  type OfficeOperationResult,
} from '../services/architectureOffice/application/engagementOperations';
import { canActAsArb } from '../services/architectureOffice/OfficeArbService';
import {
  type OfficeActor,
  type OfficeArbVerdict,
  type OfficeEngagement,
} from '../services/architectureOffice/OfficeTypes';
import { canRunEngagement } from '../services/architectureOffice/officeEngagementTransitions';
import { trackEngagementCompleted } from '../services/architectureOffice/officeTelemetry';
import type { OfficeAgentId } from '../services/architectureOffice/officeAgentPersonas';

/**
 * La intake, tal y como la escribe una pantalla.
 *
 * Es el comando de la capa de aplicación, reexportado con el nombre que los
 * consumidores ya usan. El contexto no define su propia forma: la política y su
 * vocabulario viven juntos, en `application/engagementOperations`.
 */
export type CreateEngagementInput = CreateEngagementCommand;
export type { OfficeOperationResult };

interface OfficeContextType {
  /** Engagements for the projects loaded so far, newest first. */
  engagements: OfficeEngagement[];
  /** Engagement ids currently being executed by the runner. */
  runningEngagementIds: string[];
  isLoading: boolean;
  /** True when the signed-in user may sit on the review board. */
  canApprove: boolean;

  loadEngagements: (projectId: string) => Promise<void>;
  getEngagement: (engagementId: string) => OfficeEngagement | undefined;
  listEngagementsForProject: (projectId: string) => OfficeEngagement[];

  /** Intake → charter proposal. Does not start execution. */
  createEngagement: (input: CreateEngagementInput) => Promise<OfficeOperationResult>;
  approveCharter: (engagementId: string) => Promise<OfficeOperationResult>;
  /** Runs (or resumes) the task DAG. Safe to call on a partially run engagement. */
  runEngagementNow: (engagementId: string) => Promise<OfficeOperationResult>;
  cancelRun: (engagementId: string) => void;
  /** Re-evaluates quality gates against the project's current artifacts. */
  evaluateGates: (engagementId: string) => Promise<OfficeOperationResult>;
  decideEngagement: (
    engagementId: string,
    verdict: OfficeArbVerdict,
    rationale: string,
  ) => Promise<OfficeOperationResult>;
  deleteEngagement: (engagementId: string) => Promise<OfficeOperationResult>;
}

const OfficeContext = createContext<OfficeContextType | undefined>(undefined);

/**
 * The AI surface is loaded on demand, not with this provider.
 *
 * `OfficeProvider` sits in the root provider tree, so a static import here made
 * the whole generation engine — and everything it pulls in — part of the eager
 * entry chunk, which no route can defer because it is needed before the first
 * one renders. That is what pushed the entry bundle past 2.7 MB and produced
 * the chunk-load failures on iPad Safari that `lib/lazyWithRetry.ts` exists to
 * paper over.
 *
 * Both call sites are inside async actions, so deferring costs nothing: the
 * module is fetched the first time a user actually runs an engagement, and the
 * dynamic import is cached by the module system from then on.
 */
const loadAssistant = () => import('../services/ai/generation/assistantService');

/**
 * The engagement runner is deferred for the same reason.
 *
 * `OfficeRunnerAdapters` reaches the agent executor, which reaches the AI
 * layer — a second static path from this provider into the generation engine.
 * Only running an engagement needs it, and that is always a deliberate user
 * action, so the fetch happens when the work does.
 */
const loadRunner = () =>
  Promise.all([
    import('../services/architectureOffice/OfficeRunnerAdapters'),
    import('../services/architectureOffice/OfficeEngagementRunner'),
    import('../services/architectureOffice/application/agentConfiguration'),
  ]).then(([adapters, runner, configuration]) => ({
    createOfficeRunnerPorts: adapters.createOfficeRunnerPorts,
    runEngagement: runner.runEngagement,
    loadAgentConfiguration: configuration.loadAgentConfiguration,
  }));

export const OfficeProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const {
    projects,
    settings,
    createArtifact,
    createArtifactVersion,
    updateArtifact,
  } = useAppContext();
  const { user, profile } = useAuth();

  const [engagements, setEngagements] = useState<OfficeEngagement[]>([]);
  const [runningEngagementIds, setRunningEngagementIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const loadedProjectIds = useRef(new Set<string>());
  const abortControllers = useRef(new Map<string, AbortController>());

  // The runner reads the project fresh on every task: artifacts produced by
  // earlier tasks must be visible to later ones. A captured snapshot would
  // make every deliverable see an empty project — the same defect the
  // onboarding flow has today.
  const projectsRef = useRef(projects);
  const settingsRef = useRef(settings);
  useEffect(() => { projectsRef.current = projects; }, [projects]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  /**
   * Operations read the engagement from here, never from the `engagements`
   * state closure.
   *
   * The intake wizard approves a charter and runs the engagement from a single
   * handler. A callback captured before the approval would still hold the
   * pre-approval snapshot, so the run would refuse with "el charter debe
   * aprobarse" on an engagement that was just approved. The ref is updated
   * synchronously by `upsert`, so any call order sees current state.
   */
  const engagementsRef = useRef<OfficeEngagement[]>([]);
  const readEngagement = useCallback(
    (engagementId: string) => engagementsRef.current.find((item) => item.id === engagementId),
    [],
  );

  const actor: OfficeActor = useMemo(() => ({
    id: user?.uid ?? 'local-user',
    name: profile?.displayName || user?.email || 'Arquitecto',
    // No default role. An actor whose profile has not loaded is not a
    // participant with the lowest privileges — it is an unknown, and `can()`
    // fails closed on it. Defaulting to a role here would grant the office's
    // gates to a session that has proven nothing.
    role: profile?.role ?? '',
  }), [user, profile]);

  const canApprove = canActAsArb(actor);

  const byRecency = (a: OfficeEngagement, b: OfficeEngagement): number =>
    b.updatedAt.localeCompare(a.updatedAt);

  /** Single writer: keeps the ref and the rendered state in step. */
  const commit = useCallback((next: OfficeEngagement[]) => {
    engagementsRef.current = next;
    setEngagements(next);
  }, []);

  const upsert = useCallback((engagement: OfficeEngagement) => {
    commit([
      engagement,
      ...engagementsRef.current.filter((item) => item.id !== engagement.id),
    ].sort(byRecency));
  }, [commit]);

  /**
   * Lo que la capa de aplicación necesita del navegador: cómo escribir, y qué
   * enseñar mientras la escritura viaja.
   *
   * `persistAndTrack` hacía `await …repository.save(e)` y **descartaba** el
   * `PersistenceResult` —que es justo el envoltorio que `services/persistence`
   * existe para producir— así que las seis operaciones de este contexto
   * respondían `ok: true` tanto si la escritura se confirmaba como si el
   * servidor la rechazaba por conflicto de revisión o por permiso.
   *
   * El `upsert` optimista se conserva y es deliberado: el trabajo generado no
   * se tira porque la base no esté. Lo que cambia es que ahora se sabe, y que
   * cuando la escritura se confirma lo que queda en estado es **lo que devolvió
   * el servidor**, con su revisión nueva.
   */
  const operationDeps = useMemo(() => ({
    writes: officeEngagementRepository,
    onDraft: upsert,
  }), [upsert]);

  /** El puerto de persistencia del runner, que es el mismo con otra forma. */
  const persistCheckpoint = useCallback(async (engagement: OfficeEngagement) => {
    upsert(engagement);
    const result = await officeEngagementRepository.save(engagement);
    if (result.success && result.data) upsert(result.data);
    return result;
  }, [upsert]);

  const loadEngagements = useCallback(async (projectId: string) => {
    if (loadedProjectIds.current.has(projectId)) return;
    loadedProjectIds.current.add(projectId);
    setIsLoading(true);
    try {
      const loaded = await officeEngagementRepository.list(projectId);
      commit([
        ...engagementsRef.current.filter((item) => item.projectId !== projectId),
        ...loaded,
      ].sort(byRecency));
    } finally {
      setIsLoading(false);
    }
  }, [commit]);

  const getEngagement = useCallback(
    (engagementId: string) => engagements.find((item) => item.id === engagementId),
    [engagements],
  );

  const listEngagementsForProject = useCallback(
    (projectId: string) => engagements.filter((item) => item.projectId === projectId),
    [engagements],
  );

  const createEngagement = useCallback(async (input: CreateEngagementInput): Promise<OfficeOperationResult> => {
    const project = projectsRef.current.find((candidate) => candidate.id === input.projectId);
    if (!project) return { ok: false, reason: 'El proyecto indicado no existe.' };

    return createEngagementOperation(
      {
        ...operationDeps,
        // El puerto es la llamada al modelo, no el prompt: componerlo y decidir
        // si el refinamiento vale es política de la Oficina. El import sigue
        // siendo diferido porque `OfficeProvider` vive en el árbol de
        // proveedores y uno estático metería el motor entero en el arranque.
        refineCharter: async (prompt: string) => {
          const { assistantService } = await loadAssistant();
          return assistantService.chatWithProject(project, prompt, [], settingsRef.current, 'lucia');
        },
      },
      project,
      input,
      actor,
    );
  }, [actor, operationDeps]);

  const approveCharter = useCallback(async (engagementId: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    if (!engagement) return { ok: false, reason: 'El encargo no existe.' };
    return approveCharterOperation(operationDeps, engagement, actor);
  }, [readEngagement, actor, operationDeps]);

  const runEngagementNow = useCallback(async (engagementId: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    if (!engagement) return { ok: false, reason: 'El encargo no existe.' };
    // La regla —nadie ejecuta un charter sin aprobar— la aplica `runEngagement`,
    // que es la única puerta. Esta comprobación se mantiene porque evita
    // arrancar un `AbortController` y un estado de «ejecutando» para algo que
    // se va a rechazar; ya no es donde vive la regla.
    const verdict = canRunEngagement(engagement, abortControllers.current.has(engagementId));
    if (verdict.outcome === 'refused') return { ok: false, reason: verdict.refusal.message };

    const controller = new AbortController();
    abortControllers.current.set(engagementId, controller);
    setRunningEngagementIds((previous) => [...previous, engagementId]);

    try {
      const { createOfficeRunnerPorts, runEngagement, loadAgentConfiguration } = await loadRunner();
      // Las fichas configuradas por esta organización: capacidad y nivel de
      // modelo por agente. Sin ellas el motor usa lo que trae el producto.
      const agentConfiguration = await loadAgentConfiguration(user?.uid ?? '');
      const ports = createOfficeRunnerPorts({
        getProject: () => projectsRef.current.find((candidate) => candidate.id === engagement.projectId),
        getSettings: () => settingsRef.current,
        store: { createArtifact, createArtifactVersion, updateArtifact },
        invokePersona: async (personaId: OfficeAgentId, prompt, project) => {
          const { assistantService } = await loadAssistant();
          return assistantService.chatWithProject(
            project,
            prompt,
            [],
            settingsRef.current,
            personaId,
            // El nivel configurado en la ficha del agente, no el de fábrica.
            agentConfiguration.tiers[personaId],
          );
        },
        persist: persistCheckpoint,
        onProgress: upsert,
      });

      const result = await runEngagement(engagement, ports, {
        signal: controller.signal,
        agentConcurrency: agentConfiguration.concurrency,
      });
      if (result.status === 'refused') {
        return { ok: false, engagement: result.engagement, reason: result.message };
      }

      // Las puertas se evalúan contra los artefactos que el run produjo de
      // verdad, así que esto va después y sobre el proyecto refrescado.
      const project = projectsRef.current.find((candidate) => candidate.id === engagement.projectId);
      let finished = result.engagement;
      if (project) {
        const gated = await evaluateGatesOperation(operationDeps, finished, project);
        finished = gated.engagement ?? finished;
      }

      trackEngagementCompleted(finished);
      // Un run que se detuvo porque no se pudo guardar no terminó: `ok: false`
      // con su motivo, como cualquier otra escritura no confirmada.
      return {
        ok: result.status !== 'cancelled' && result.status !== 'not-persisted',
        engagement: finished,
        reason: result.message,
        persistence: result.persistence,
      };
    } finally {
      abortControllers.current.delete(engagementId);
      setRunningEngagementIds((previous) => previous.filter((id) => id !== engagementId));
    }
  }, [readEngagement, createArtifact, createArtifactVersion, updateArtifact, persistCheckpoint, operationDeps, upsert, user]);

  const cancelRun = useCallback((engagementId: string) => {
    abortControllers.current.get(engagementId)?.abort();
  }, []);

  const evaluateGates = useCallback(async (engagementId: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    if (!engagement) return { ok: false, reason: 'El encargo no existe.' };
    const project = projectsRef.current.find((candidate) => candidate.id === engagement.projectId);
    if (!project) return { ok: false, reason: 'El proyecto del encargo no está disponible.' };
    return evaluateGatesOperation(operationDeps, engagement, project);
  }, [readEngagement, operationDeps]);

  const decideEngagement = useCallback(async (
    engagementId: string,
    verdict: OfficeArbVerdict,
    rationale: string,
  ): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    if (!engagement) return { ok: false, reason: 'El encargo no existe.' };
    return decideEngagementOperation(operationDeps, engagement, { verdict, rationale, actor });
  }, [readEngagement, actor, operationDeps]);

  const deleteEngagement = useCallback(async (engagementId: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    if (!engagement) return { ok: false, reason: 'El encargo no existe.' };
    abortControllers.current.get(engagementId)?.abort();
    commit(engagementsRef.current.filter((item) => item.id !== engagementId));
    return deleteEngagementOperation({ ...operationDeps, onRestore: upsert }, engagement);
  }, [readEngagement, commit, upsert, operationDeps]);

  const value = useMemo<OfficeContextType>(() => ({
    engagements,
    runningEngagementIds,
    isLoading,
    canApprove,
    loadEngagements,
    getEngagement,
    listEngagementsForProject,
    createEngagement,
    approveCharter,
    runEngagementNow,
    cancelRun,
    evaluateGates,
    decideEngagement,
    deleteEngagement,
  }), [
    engagements, runningEngagementIds, isLoading, canApprove,
    loadEngagements, getEngagement, listEngagementsForProject,
    createEngagement, approveCharter, runEngagementNow, cancelRun,
    evaluateGates, decideEngagement, deleteEngagement,
  ]);

  return <OfficeContext.Provider value={value}>{children}</OfficeContext.Provider>;
};

export const useOffice = (): OfficeContextType => {
  const context = useContext(OfficeContext);
  if (context === undefined) {
    throw new Error('useOffice debe usarse dentro de un OfficeProvider');
  }
  return context;
};

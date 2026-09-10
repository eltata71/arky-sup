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
import { evaluateOfficeQualityGates } from '../services/architectureOffice/officeQualityGates';
import {
  applyCharterRefinement,
  buildCharterRefinementPrompt,
  planCharterDeterministic,
} from '../services/architectureOffice/OfficeEngagementPlanner';
import {
  officeEngagementRepository,
} from '../services/architectureOffice/OfficeEngagementRepository';
import {
  approveCharter as approveCharterRule,
  attachGateAssessment,
  canActAsArb,
  decideEngagement as decideEngagementRule,
} from '../services/architectureOffice/OfficeArbService';
import {
  type OfficeActor,
  type OfficeArbVerdict,
  type OfficeEngagement,
  type OfficeEngagementPriority,
} from '../services/architectureOffice/OfficeTypes';
import { createOfficeEngagement } from '../services/architectureOffice/officeEngagementFactory';
import { canRunEngagement } from '../services/architectureOffice/officeEngagementTransitions';
import { trackEngagementCompleted } from '../services/architectureOffice/officeTelemetry';
import type { OfficeAgentId } from '../services/architectureOffice/officeAgentPersonas';

export interface CreateEngagementInput {
  projectId: string;
  title: string;
  brief: string;
  /**
   * Ids of the business initiatives the deliverable serves — the canonical
   * link. Defaults to whatever its project answers.
   */
  initiativeIds?: string[];
  businessProjectIds?: string[];
  /** How urgent the deliverable is. Defaults to 'medium' when not stated. */
  priority?: OfficeEngagementPriority;
  /** When the business needs it. */
  dueAt?: string;
  maxDeliverables?: number;
  /** Skip the AI refinement pass (used by tests and offline mode). */
  deterministicOnly?: boolean;
}

export interface OfficeOperationResult {
  ok: boolean;
  engagement?: OfficeEngagement;
  reason?: string;
}

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

  const persistAndTrack = useCallback(async (engagement: OfficeEngagement) => {
    upsert(engagement);
    await officeEngagementRepository.save(engagement);
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

    const scaffold = planCharterDeterministic({
      title: input.title,
      brief: input.brief,
      maxDeliverables: input.maxDeliverables,
    });

    let charter = scaffold;
    if (!input.deterministicOnly) {
      try {
        const { assistantService } = await loadAssistant();
        const raw = await assistantService.chatWithProject(
          project,
          buildCharterRefinementPrompt({ title: input.title, brief: input.brief }, scaffold),
          [],
          settingsRef.current,
          'lucia',
        );
        const refinement = applyCharterRefinement(scaffold, raw);
        charter = refinement.charter;
      } catch {
        // The deterministic charter is a complete, runnable plan. An
        // unavailable model degrades the plan's quality, never its existence.
      }
    }

    const created = createOfficeEngagement({
      projectId: input.projectId,
      title: input.title,
      brief: input.brief,
      // El entregable hereda las iniciativas de su atención salvo que la intake
      // las haya estrechado. Qué pasa si no queda ninguna lo decide la fábrica,
      // no esta pantalla.
      initiativeIds: input.initiativeIds ?? project.initiativeIds ?? [],
      businessProjectIds: input.businessProjectIds ?? project.linkedBusinessProjects ?? [],
      charter,
      priority: input.priority,
      dueAt: input.dueAt,
      createdBy: actor,
    });
    if (created.outcome === 'rejected') {
      return { ok: false, reason: created.rejection.message };
    }
    const audited = created.engagement;

    await persistAndTrack(audited);
    return { ok: true, engagement: audited };
  }, [actor, persistAndTrack]);

  const approveCharter = useCallback(async (engagementId: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    if (!engagement) return { ok: false, reason: 'El encargo no existe.' };

    const result = approveCharterRule(engagement, actor);
    if (!result.ok) return { ok: false, reason: result.reason };

    await persistAndTrack(result.engagement);
    return { ok: true, engagement: result.engagement };
  }, [readEngagement, actor, persistAndTrack]);

  const runEngagementNow = useCallback(async (engagementId: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    if (!engagement) return { ok: false, reason: 'El encargo no existe.' };
    // La regla —nadie ejecuta un charter sin aprobar— es del dominio. Lo único
    // que aporta esta pantalla es si su propio runner está ocupado.
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
        persist: persistAndTrack,
        onProgress: upsert,
      });

      const result = await runEngagement(engagement, ports, {
        signal: controller.signal,
        agentConcurrency: agentConfiguration.concurrency,
      });

      // Gates are evaluated against the artifacts the run actually produced,
      // so this has to happen after the run, on the refreshed project.
      const project = projectsRef.current.find((candidate) => candidate.id === engagement.projectId);
      let finished = result.engagement;
      if (project) {
        finished = attachGateAssessment(finished, evaluateOfficeQualityGates(project));
        await persistAndTrack(finished);
      }

      trackEngagementCompleted(finished);
      return { ok: result.status !== 'cancelled', engagement: finished, reason: result.message };
    } finally {
      abortControllers.current.delete(engagementId);
      setRunningEngagementIds((previous) => previous.filter((id) => id !== engagementId));
    }
  }, [readEngagement, createArtifact, createArtifactVersion, updateArtifact, persistAndTrack, upsert, user]);

  const cancelRun = useCallback((engagementId: string) => {
    abortControllers.current.get(engagementId)?.abort();
  }, []);

  const evaluateGates = useCallback(async (engagementId: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    if (!engagement) return { ok: false, reason: 'El encargo no existe.' };
    const project = projectsRef.current.find((candidate) => candidate.id === engagement.projectId);
    if (!project) return { ok: false, reason: 'El proyecto del encargo no está disponible.' };

    const updated = attachGateAssessment(engagement, evaluateOfficeQualityGates(project));
    await persistAndTrack(updated);
    return { ok: true, engagement: updated };
  }, [readEngagement, persistAndTrack]);

  const decideEngagement = useCallback(async (
    engagementId: string,
    verdict: OfficeArbVerdict,
    rationale: string,
  ): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    if (!engagement) return { ok: false, reason: 'El encargo no existe.' };

    const result = decideEngagementRule(engagement, { verdict, rationale, actor });
    if (!result.ok) return { ok: false, reason: result.reason };

    await persistAndTrack(result.engagement);
    if (result.decision) {
      // Best-effort: the immutable subcollection is the tamper-evident record,
      // but the engagement mirror is already saved so a rules rejection here
      // (non-admin) does not lose the UI state — it just means the decision
      // was never authoritative, which is the correct outcome.
      await officeEngagementRepository.recordArbDecision(result.engagement, result.decision);
    }
    return { ok: true, engagement: result.engagement };
  }, [readEngagement, actor, persistAndTrack]);

  const deleteEngagement = useCallback(async (engagementId: string): Promise<OfficeOperationResult> => {
    const engagement = readEngagement(engagementId);
    if (!engagement) return { ok: false, reason: 'El encargo no existe.' };
    abortControllers.current.get(engagementId)?.abort();
    commit(engagementsRef.current.filter((item) => item.id !== engagementId));
    await officeEngagementRepository.remove(engagement.projectId, engagementId);
    return { ok: true };
  }, [readEngagement, commit]);

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

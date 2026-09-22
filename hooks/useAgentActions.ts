import { useCallback, useRef, useState } from 'react';
import type { Settings } from '../types';
import type { Artifact } from '../lib/artifacts';
import type { Project } from '../services/architectureProjects';
import type { ArtifactReviewSuggestion } from '../services/review';
import type { ChatMessage } from '../services/chat';
import {
  classifyAgentIntent,
  executeAgentAction,
  planAgentAction,
  refineIntentWithLLM,
  LLM_REFINEMENT_THRESHOLD,
  detectProactiveSuggestion,
  buildAgentActionRecord,
  MIN_EXECUTION_CONFIDENCE,
  type AgentActionPlan,
  type AgentActionRecord,
  type AgentActionResult,
  type AgentContext,
  type AgentExecutionPhase,
  type AgentExecutionTarget,
  type AgentIntent,
  type AgentMemoryStore,
  type MemoryDraft,
  type ProactiveSuggestion,
} from '../services/agent';
import { extractMemoryBullets, fallbackBulletsFromInstruction } from '../services/agent/memoryExtractor';
import { buildAgentLesson, mergeAgentLesson } from '../services/agent/agentLessonRecorder';

/**
 * React-side controller for the agent. Owns:
 *  - the pending action plan (shown as a card in the chat),
 *  - the currently executing phase,
 *  - the latest execution result,
 *  - the last proactive suggestion detected in a model response.
 *
 * The hook deliberately does NOT call the AI on its own beyond the optional
 * intent reclassification — that work is deferred to the executor. This keeps
 * latency predictable and makes the hook unit-testable without network mocks.
 */
export interface UseAgentActionsResult {
  /** Plan waiting for the user to confirm/cancel — or `null` if nothing is pending. */
  pendingPlan: AgentActionPlan | null;
  /** Live phase while we're executing. */
  executionPhase: AgentExecutionPhase;
  /** Last result we showed in the chat — kept so UI can render the success/error card. */
  lastResult: AgentActionResult | null;
  /** Latest intent we classified (debug surface; not rendered by default). */
  lastIntent: AgentIntent | null;
  /** Latest proactive suggestion detected from a model response. */
  proactiveSuggestion: ProactiveSuggestion | null;
  /** Editable memory draft when the current plan is a `memory.save.*` action. */
  memoryDraft: MemoryDraft | null;
  /**
   * Propose an action from the user's latest turn. Returns `null` if no
   * actionable intent. When the heuristic confidence is low, an async LLM
   * upgrade may follow via `refineLowConfidencePlan`.
   */
  proposePlan: (params: {
    userInput: string;
    artifact: Artifact | null;
    viewMode: string | null;
    history: ChatMessage[];
    hasPendingSuggestions: boolean;
    project?: Project;
  }) => AgentActionPlan | null;
  /**
   * After a stream completes, scan the model response and surface a
   * one-click proactive action if the model recommended something
   * applicable. Returns the suggestion (or `null`).
   */
  scanForProactiveSuggestion: (modelResponse: string) => ProactiveSuggestion | null;
  /**
   * Promote a proactive suggestion to a pending plan. The user still needs
   * to confirm via the card buttons — no autopilot.
   */
  acceptProactiveSuggestion: (params: {
    suggestion: ProactiveSuggestion;
    artifact: Artifact;
    viewMode: string | null;
    history: ChatMessage[];
    project?: Project;
  }) => AgentActionPlan | null;
  /** Drop the proactive suggestion (user dismissed it). */
  dismissProactiveSuggestion: () => void;
  /**
   * Trigger AI extraction of memory bullets for the current pending plan.
   * Called automatically once a `memory.save.*` plan becomes pending; safe to
   * call again to retry on failure.
   */
  prepareMemoryDraft: (params: {
    history: ChatMessage[];
    project?: Project;
    artifact?: Artifact | null;
    settings: Settings;
  }) => Promise<void>;
  /** Replace the editable draft (bullets / scope). User-driven from the card. */
  updateMemoryDraft: (next: Partial<MemoryDraft>) => void;
  /**
   * For low-confidence heuristic plans, optionally upgrade via Gemini and
   * replace the pending plan if the LLM is more confident. Safe to await
   * after `proposePlan` — never throws.
   */
  refineLowConfidencePlan: (params: {
    userInput: string;
    artifact: Artifact;
    viewMode: string | null;
    history: ChatMessage[];
    hasPendingSuggestions: boolean;
    project?: Project;
    settings: Settings;
  }) => Promise<void>;
  /** Force-execute the pending plan with an explicit target (current vs. new_version). */
  confirmAndExecute: (params: {
    artifact: Artifact;
    project: Project;
    settings: Settings;
    history: ChatMessage[];
    pendingSuggestions?: ArtifactReviewSuggestion[];
    store: import('../services/agent').AgentArtifactStore;
    /**
     * Persistence handlers for the three memory scopes. Required when the
     * pending plan is a `memory.save.*` action; ignored otherwise.
     */
    memoryStore?: AgentMemoryStore;
    targetOverride?: AgentExecutionTarget;
    /** Optional hooks fired after the executor wraps up — typically wiring to AppContext logging + rollback. */
    onPersistRecord?: (record: AgentActionRecord) => void | Promise<void>;
    actor?: { id: string | null; name: string | null };
    /**
     * Optional learning loop: when provided, a deterministic lesson derived
     * from the action outcome is appended to the project agent memory
     * (bounded, low priority, signed "Arquitecto Agente"). Best-effort.
     */
    lessonStore?: {
      getProjectAgentMemory: (projectId: string) => { texts: string[]; entries: import('../types').MemoryEntry[] };
      updateProjectAgentMemory: (projectId: string, texts: string[], entries: import('../types').MemoryEntry[]) => void;
    };
  }) => Promise<AgentActionResult>;
  cancelPlan: () => void;
  /** Wipe the last result banner. */
  acknowledgeResult: () => void;
}

export function useAgentActions(): UseAgentActionsResult {
  const [pendingPlan, setPendingPlan] = useState<AgentActionPlan | null>(null);
  const [executionPhase, setExecutionPhase] = useState<AgentExecutionPhase>('idle');
  const [lastResult, setLastResult] = useState<AgentActionResult | null>(null);
  const [lastIntent, setLastIntent] = useState<AgentIntent | null>(null);
  const [proactiveSuggestion, setProactiveSuggestion] = useState<ProactiveSuggestion | null>(null);
  const [memoryDraft, setMemoryDraft] = useState<MemoryDraft | null>(null);

  const planRef = useRef<AgentActionPlan | null>(null);
  planRef.current = pendingPlan;
  const memoryDraftRef = useRef<MemoryDraft | null>(null);
  memoryDraftRef.current = memoryDraft;

  const proposePlan = useCallback<UseAgentActionsResult['proposePlan']>(
    ({ userInput, artifact, viewMode, history, hasPendingSuggestions, project }) => {
      const ctx: AgentContext = { artifact, viewMode, history, hasPendingSuggestions };
      const intent = classifyAgentIntent(userInput, ctx);
      setLastIntent(intent);
      if (intent.type === 'unknown' || intent.type === 'artifact.explainOnly') {
        setPendingPlan(null);
        setMemoryDraft(null);
        return null;
      }
      // Memory actions can fire without an active artifact (global/project
      // scopes). Creation actions also fire without an active artifact since
      // they materialise a brand-new one. Other actions still require one.
      const isMemoryAction = intent.type.startsWith('memory.save.');
      const isCreateAction = intent.type === 'artifact.create';
      if (!isMemoryAction && !isCreateAction && !artifact) {
        setPendingPlan(null);
        setMemoryDraft(null);
        return null;
      }
      // For memory/create actions we need an anchor artifact to satisfy the
      // plan signature, but it doesn't have to be present in the project — we
      // synthesize a minimal anchor when one isn't available.
      const planArtifact = artifact ?? createMemoryAnchorArtifact();
      const plan = planAgentAction({ intent, artifact: planArtifact, project });
      setPendingPlan(plan);
      // Seed a memory draft when this is a memory action so the card has
      // something to render immediately ("Extrayendo conceptos…").
      if (isMemoryAction && intent.memoryScope) {
        setMemoryDraft({ scope: intent.memoryScope, bullets: [], status: 'extracting' });
      } else {
        setMemoryDraft(null);
      }
      // Clear stale proactive suggestion — the user just took the wheel.
      setProactiveSuggestion(null);
      return plan;
    },
    [],
  );

  const prepareMemoryDraft = useCallback<UseAgentActionsResult['prepareMemoryDraft']>(
    async ({ history, project, artifact, settings }) => {
      const plan = planRef.current;
      if (!plan || !plan.actionType.startsWith('memory.save.')) return;
      const scope =
        memoryDraftRef.current?.scope ??
        plan.intent.memoryScope ??
        (plan.actionType === 'memory.save.global' ? 'global' : plan.actionType === 'memory.save.artifact' ? 'artifact' : 'project');
      setMemoryDraft((curr) => (curr ? { ...curr, status: 'extracting' } : { scope, bullets: [], status: 'extracting' }));
      try {
        const bullets = await extractMemoryBullets({
          scope,
          history,
          userInstruction: plan.intent.userInstruction,
          artifactName: artifact?.name ?? null,
          projectName: project?.name ?? null,
          settings,
        });
        if (planRef.current?.traceId !== plan.traceId) return; // plan changed mid-flight
        if (bullets && bullets.length > 0) {
          setMemoryDraft({ scope, bullets, status: 'ready' });
        } else {
          // Fall back to a sanitised version of the user's literal instruction
          // so we always offer something to confirm.
          const fallback = fallbackBulletsFromInstruction(plan.intent.userInstruction);
          setMemoryDraft({
            scope,
            bullets: fallback,
            status: fallback.length > 0 ? 'ready' : 'failed',
            errorMessage: fallback.length === 0 ? 'No pude extraer conceptos para guardar.' : undefined,
          });
        }
      } catch (err) {
        if (planRef.current?.traceId !== plan.traceId) return;
        setMemoryDraft((curr) => ({
          scope: curr?.scope ?? scope,
          bullets: curr?.bullets ?? [],
          status: 'failed',
          errorMessage: err instanceof Error ? err.message : 'Falló la extracción de conceptos.',
        }));
      }
    },
    [],
  );

  const updateMemoryDraft = useCallback<UseAgentActionsResult['updateMemoryDraft']>((next) => {
    setMemoryDraft((curr) => {
      if (!curr) return curr;
      return { ...curr, ...next };
    });
  }, []);

  const refineLowConfidencePlan = useCallback<UseAgentActionsResult['refineLowConfidencePlan']>(
    async ({ userInput, artifact, viewMode, history, hasPendingSuggestions, project, settings }) => {
      const current = planRef.current;
      if (!current) return;
      if (current.intent.confidence >= LLM_REFINEMENT_THRESHOLD) return;
      try {
        const ctx: AgentContext = { artifact, viewMode, history, hasPendingSuggestions };
        const heuristic = classifyAgentIntent(userInput, ctx);
        const refined = await refineIntentWithLLM({
          userInput,
          context: ctx,
          heuristicIntent: heuristic,
          settings,
        });
        if (refined.type === 'unknown' || refined.type === 'artifact.explainOnly') return;
        // Only replace if the refined intent is more confident than what the
        // user is already looking at on the card.
        const inPlace = planRef.current;
        if (!inPlace || inPlace.traceId !== current.traceId) return;
        if (refined.confidence <= inPlace.intent.confidence + 0.05) return;
        const next = planAgentAction({ intent: refined, artifact, project });
        setPendingPlan(next);
        setLastIntent(refined);
      } catch {
        // The heuristic plan stays — LLM is a best-effort upgrade.
      }
    },
    [],
  );

  const scanForProactiveSuggestion = useCallback<UseAgentActionsResult['scanForProactiveSuggestion']>(
    (modelResponse) => {
      const found = detectProactiveSuggestion(modelResponse);
      setProactiveSuggestion(found);
      return found;
    },
    [],
  );

  const acceptProactiveSuggestion = useCallback<UseAgentActionsResult['acceptProactiveSuggestion']>(
    ({ suggestion, artifact, viewMode, history, project }) => {
      // Build a synthetic intent that mirrors what `classifyAgentIntent` would
      // produce if the user had typed the same instruction.
      const intent: AgentIntent = {
        type: suggestion.intentType,
        confidence: suggestion.confidence,
        userInstruction: suggestion.derivedInstruction,
        artifactId: artifact.id,
        artifactVersionGroupId: artifact.versionGroupId,
        artifactViewContext: viewMode,
        extractedRequirements: [],
        requiresConfirmation: true,
        impact: suggestion.intentType === 'artifact.regenerate' ? 'high' : 'medium',
        suggestedTarget: 'new_version',
      };
      const plan = planAgentAction({ intent, artifact, project });
      setPendingPlan(plan);
      setLastIntent(intent);
      setProactiveSuggestion(null);
      // history not used here but kept on the signature for future LLM hooks.
      void history;
      return plan;
    },
    [],
  );

  const dismissProactiveSuggestion = useCallback(() => {
    setProactiveSuggestion(null);
  }, []);

  const cancelPlan = useCallback(() => {
    setPendingPlan((current) => {
      if (current) {
        void import('../services/agent').then((m) =>
          m.logAgentEvent({
            traceId: current.traceId,
            phase: 'cancelled',
            level: 'info',
            message: 'Plan cancelado por el usuario.',
            meta: { actionType: current.actionType },
          }),
        );
      }
      return null;
    });
    setExecutionPhase('idle');
    setMemoryDraft(null);
  }, []);

  const acknowledgeResult = useCallback(() => {
    setLastResult(null);
  }, []);

  const confirmAndExecute = useCallback<UseAgentActionsResult['confirmAndExecute']>(
    async ({ artifact, project, settings, history, pendingSuggestions, store, memoryStore, targetOverride, onPersistRecord, actor, lessonStore }) => {
      const plan = planRef.current;
      if (!plan) {
        const empty: AgentActionResult = {
          status: 'cancelled',
          newArtifactVersionId: null,
          previousArtifactVersionId: artifact.id,
          appliedChanges: [],
          validationResult: null,
          messages: ['No hay un plan pendiente.'],
          errors: [],
          traceId: 'none',
        };
        setLastResult(empty);
        return empty;
      }

      // Snapshot the current memory draft so the user's edits in the card
      // are the source of truth, not whatever state existed before.
      const draftSnapshot = memoryDraftRef.current;

      setExecutionPhase('analyzing');
      const result = await executeAgentAction({
        plan,
        artifact,
        project,
        settings,
        history,
        pendingSuggestions,
        store,
        memoryStore,
        memoryBullets: draftSnapshot?.bullets,
        targetOverride,
        // `confirmAndExecute` only ever runs on a plan the user has seen in the
        // action card and accepted; that acceptance is what this flag carries
        // into the executor's gate.
        confirmedByUser: true,
        actor: actor ? { id: actor.id ?? null, name: actor.name ?? null } : undefined,
        onPhase: (phase) => setExecutionPhase(phase),
      });

      // Always persist a record — both successes and failures are auditable.
      try {
        const record = buildAgentActionRecord({
          plan,
          result,
          projectId: project.id,
          actorId: actor?.id ?? null,
          actorName: actor?.name ?? null,
          memoryScope: draftSnapshot?.scope ?? plan.intent.memoryScope ?? null,
          memoryBullets: draftSnapshot?.bullets ?? null,
        });
        if (onPersistRecord) await onPersistRecord(record);
      } catch {
        // Persistence must never break the executor flow.
      }

      // Automatic learning loop: derive a deterministic lesson from the
      // outcome and persist it into the project agent memory. Best-effort —
      // a failure here never affects the action result.
      if (lessonStore) {
        try {
          const lesson = buildAgentLesson(plan, result, artifact.name);
          if (lesson) {
            const current = lessonStore.getProjectAgentMemory(project.id);
            const merged = mergeAgentLesson({
              existingTexts: current.texts,
              existingEntries: current.entries,
              lesson,
            });
            if (merged) lessonStore.updateProjectAgentMemory(project.id, merged.texts, merged.entries);
          }
        } catch {
          // Learning loop must never break the executor flow.
        }
      }

      setExecutionPhase(result.status === 'success' ? 'done' : 'failed');
      setLastResult(result);
      setPendingPlan(null);
      setMemoryDraft(null);
      return result;
    },
    [],
  );

  return {
    pendingPlan,
    executionPhase,
    lastResult,
    lastIntent,
    proactiveSuggestion,
    memoryDraft,
    proposePlan,
    scanForProactiveSuggestion,
    acceptProactiveSuggestion,
    dismissProactiveSuggestion,
    prepareMemoryDraft,
    updateMemoryDraft,
    refineLowConfidencePlan,
    confirmAndExecute,
    cancelPlan,
    acknowledgeResult,
  };
}

export { MIN_EXECUTION_CONFIDENCE };

/**
 * Synthetic anchor artifact used to satisfy the planner signature on
 * memory-save actions when no artifact is active. The planner only reads
 * `id`, `versionGroupId` and `name` from the anchor — nothing is persisted
 * with this stub, and the executor's memory branch never calls
 * `createArtifactVersion`/`updateArtifact` on it.
 */
function createMemoryAnchorArtifact(): Artifact {
  const now = new Date().toISOString();
  return {
    id: 'memory-anchor',
    versionGroupId: 'memory-anchor',
    version: 1,
    createdAt: now,
    name: 'Conversación actual',
    type: 'markdown',
    phase: '—',
    architecturalView: 'Vista de Gestión y Soporte',
    content: '',
    objective: 'Anclaje sintético para acciones de memoria sin artefacto activo.',
    keyConcepts: [],
    representation: 'document',
  };
}

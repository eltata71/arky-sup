/**
 * services/agent — Agentic capability for the Arquitecto Agente.
 *
 * This module turns the conversational assistant into a controlled, traceable
 * agent that can EXECUTE actions on the active artifact (regenerate, improve,
 * patch, version) while reusing the existing AI, versioning and quality
 * pipelines. Nothing here re-implements logic that already lives in
 * `services/ai`, `context/AppContext.tsx` or `services/diagram/qualityGate.ts`;
 * this layer ORCHESTRATES those.
 *
 * `services/ai`, not `services/geminiService`: the engine is an implementation
 * detail of the AI kernel and nothing outside it may import it — ESLint says so
 * and `__tests__/services/ai/publicApiSurface.test.ts` says so. This module
 * reaches a model through `aiGateway`, which is the surface for layers that
 * legitimately compose their own prompts. Naming the engine here was the last
 * place in the agent that still pointed at it, and a stale pointer in a
 * docblock is how the next author learns the wrong rule.
 */

import type { Artifact } from '../../lib/artifacts';
import type { ChatMessage } from '../chat';

/** All intents the assistant can act on. `unknown` means "no actionable intent". */
export type AgentIntentType =
  | 'artifact.create'
  | 'artifact.regenerate'
  | 'artifact.improve'
  | 'artifact.patch'
  | 'artifact.createVersion'
  | 'artifact.applySuggestion'
  | 'artifact.explainOnly'
  | 'artifacts.batch'
  | 'memory.save.global'
  | 'memory.save.project'
  | 'memory.save.artifact'
  | 'unknown';

/** Where a "save to memory" action lands. Each scope is a different string[] store. */
export type MemoryScope = 'global' | 'project' | 'artifact';

/** Severity-ish bucket used to decide whether the agent must ask for confirmation. */
export type AgentImpactLevel = 'low' | 'medium' | 'high';

/** Where the resulting change should land. Defaults to `new_version` for safety. */
export type AgentExecutionTarget = 'current' | 'new_version';

/**
 * Structured intent extracted from a user turn. The classifier is a heuristic
 * (keyword + context) so it stays sync and zero-cost. When in doubt it returns
 * `{ type: 'unknown' }` so the assistant falls back to the conversational path.
 */
export interface AgentIntent {
  type: AgentIntentType;
  /** Confidence 0..1. Below `MIN_EXECUTION_CONFIDENCE` we always require confirmation. */
  confidence: number;
  userInstruction: string;
  artifactId: string | null;
  artifactVersionGroupId: string | null;
  /** UI surface the user was on when the intent was emitted ('diagram' | 'document' | …). */
  artifactViewContext: string | null;
  /** Free-form bullet list of requirements/constraints we extracted from the user turn. */
  extractedRequirements: string[];
  /** Whether the agent should pause and ask the user to confirm before executing. */
  requiresConfirmation: boolean;
  /** How impactful the proposed action is. Drives the confirmation banner copy. */
  impact: AgentImpactLevel;
  /** Suggested execution target — kept as a hint so the user can still flip it in the UI. */
  suggestedTarget: AgentExecutionTarget;
  /**
   * Optional batch scope for multi-artifact actions. When populated, the
   * executor iterates over each artifact applying the chosen subaction
   * (improve / patch). Empty/undefined → single-artifact action.
   */
  batchScope?: {
    /** Type of action to apply to each artifact in the batch. */
    subAction: 'artifact.improve' | 'artifact.patch';
    /** Match criteria — the planner resolves these into concrete artifact ids. */
    matcher: BatchMatcher;
  };
  /**
   * Explicit memory scope detected for `memory.save.*` intents. Distinct from
   * `type` so the executor can route uniformly without re-parsing the intent
   * type. Defaults to the project scope when the user didn't specify one.
   */
  memoryScope?: MemoryScope;
  /**
   * Hint about which catalog template best matches the user's request. Only
   * populated for `artifact.create` intents — the planner surfaces this in the
   * card and the executor uses it as the generation seed. `null` means the
   * matcher found no strong candidate; the executor will synthesise a custom
   * template from the instruction.
   */
  createHint?: {
    /** Catalog template name when the matcher hit a strong match. */
    templateName: string | null;
    /** Optional artifact type override (when the user said "diagrama de X"). */
    artifactType?: string;
    /** Free-form objective extracted from the user turn. */
    objective?: string;
    /** Confidence 0..1 of the template match. */
    matchConfidence?: number;
    /**
     * Identidad determinista del artefacto a crear, cuando el llamante la
     * aporta. La Oficina la deriva de `executionId`: si el efecto ya ocurrió y
     * el checkpoint se perdió, recrear con el mismo id **encuentra** el
     * artefacto existente en vez de crear un segundo. `null`/ausente conserva
     * la identidad aleatoria de fábrica — el resto de llamantes no cambia.
     */
    deterministicArtifactId?: string | null;
  };
  /**
   * Candidate artifact ids when the user referenced an artifact by name/type
   * but several latest-version artifacts match. The planner surfaces this so
   * the UI can render a selector card; the executor refuses to run until the
   * user disambiguates.
   */
  artifactCandidateIds?: string[];
}

/**
 * Editable draft of what will be persisted to memory. Held by the hook (not
 * the plan) because the user can iterate on the bullets — add, edit, remove —
 * before confirming. The plan stays immutable; only the draft mutates.
 */
export interface MemoryDraft {
  scope: MemoryScope;
  bullets: string[];
  /** Lifecycle of the AI extraction that produces the initial draft. */
  status: 'extracting' | 'ready' | 'failed';
  /** Populated when `status === 'failed'`. Surfaced in the card. */
  errorMessage?: string;
}

/**
 * Describes which artifacts in a project a batch action should target. Kept
 * declarative so the same criteria can be re-evaluated against future state
 * (no stale id list baked into the plan).
 */
export type BatchMatcher =
  | { kind: 'all' }
  | { kind: 'view'; view: string }
  | { kind: 'type'; type: string }
  | { kind: 'ids'; ids: string[] };

/**
 * The plan that's shown to the user BEFORE we execute anything. Renders as the
 * "Plan de acción" card in the AssistantPanel.
 */
export interface AgentActionPlan {
  actionId: string;
  intent: AgentIntent;
  artifactId: string;
  currentVersionId: string;
  actionType: AgentIntentType;
  /** Headline for the card. */
  title: string;
  /** Short, user-friendly paragraph. */
  summary: string;
  /** Why this action is appropriate; populates the "Detalles" disclosure. */
  rationale: string;
  /** Bullet list of areas the action will touch ("Contenido", "Layout", "Calidad"…). */
  affectedAreas: string[];
  /** Bullet list of known risks ("Puede sobrescribir descripciones", "Recalcula layout"…). */
  risks: string[];
  /** Default execution target — the user can flip this in the card. */
  target: AgentExecutionTarget;
  requiresConfirmation: boolean;
  status: 'pending' | 'executing' | 'success' | 'failed' | 'cancelled';
  createdAt: string;
  /** Correlation id mirrored across `AgentTraceEvent`s for this action. */
  traceId: string;
  /**
   * For batch plans: the artifact ids the planner resolved at plan-time. Kept
   * on the plan so the user sees what will be touched before confirming.
   */
  batchArtifactIds?: string[];
}

/** Granular state we surface in the action card while we're executing. */
export type AgentExecutionPhase =
  | 'idle'
  | 'analyzing'
  | 'preparing'
  | 'generating'
  | 'validating'
  | 'persisting'
  | 'done'
  | 'failed';

/** Outcome of an executed action. Always preserves the previous version for rollback. */
export interface AgentActionResult {
  status: 'success' | 'failed' | 'partial' | 'cancelled' | 'requires_selection';
  /** Newly created artifact version, if any. */
  newArtifactVersionId: string | null;
  /**
   * Identifier of the brand-new artifact when the action created one from
   * scratch (`artifact.create`). Distinct from `newArtifactVersionId`, which
   * is only populated when an existing artifact gained a new version.
   */
  newArtifactId?: string | null;
  previousArtifactVersionId: string;
  /** Bullet summary of what changed (for the chat acknowledgement). */
  appliedChanges: string[];
  /** Result of the post-execution quality validation. */
  validationResult: {
    passed: boolean;
    summary: string;
    score?: number;
  } | null;
  /** Messages safe to show in the chat UI. */
  messages: string[];
  /** Technical errors — go to the log, not the chat. */
  errors: string[];
  /** Same correlation id as the originating plan. */
  traceId: string;
}

/**
 * Lightweight, append-only audit record. Mirrors the assertions we make in the
 * UI and persists to in-memory plus console (no extra Firestore writes — the
 * artifact versions themselves are the source of truth for rollback).
 */
export interface AgentTraceEvent {
  traceId: string;
  /** ISO timestamp. */
  at: string;
  phase: AgentExecutionPhase | 'intent' | 'plan' | 'cancelled';
  message: string;
  level: 'info' | 'warn' | 'error';
  meta?: Record<string, unknown>;
}

/** Context the classifier needs from the active surface. Kept compact on purpose. */
export interface AgentContext {
  artifact: Artifact | null;
  /** Active view in the canvas — 'diagram' | 'document' | 'split' | etc. */
  viewMode: string | null;
  /** Recent chat history (already-tail-trimmed by the caller). */
  history: ChatMessage[];
  /** Whether there's an unapplied set of artifact suggestions available. */
  hasPendingSuggestions: boolean;
}

/** Threshold below which the agent always asks for confirmation. */
export const MIN_EXECUTION_CONFIDENCE = 0.62;

/**
 * Durable, append-only record of an agent action. Persisted to Firestore
 * under `projects/{projectId}/agent_actions/{traceId}`. Mirrored to
 * localStorage when Firestore is offline.
 *
 * The record is intentionally NOT the source of truth for rollback — that
 * stays with the artifact versions in `projects/{projectId}/artifacts`. This
 * collection exists for auditability and for surfacing recent agent activity
 * in the UI.
 */
export interface AgentActionRecord {
  traceId: string;
  actionId: string;
  projectId: string;
  artifactVersionGroupId: string;
  previousArtifactVersionId: string;
  newArtifactVersionId: string | null;
  actionType: AgentIntentType;
  status: 'success' | 'failed' | 'partial' | 'cancelled';
  target: AgentExecutionTarget;
  userInstruction: string;
  appliedChanges: string[];
  validationSummary: string | null;
  validationScore: number | null;
  errors: string[];
  /** Optional — only populated for multi-artifact batch actions. */
  affectedArtifactIds?: string[];
  /** Optional — only populated for `memory.save.*` actions. */
  memoryScope?: MemoryScope;
  /** Optional — the bullets that were persisted, for audit. */
  memoryBullets?: string[];
  /** Who triggered the action. Falls back to 'local-user' when unauthenticated. */
  actorId: string;
  actorName: string;
  /** ISO timestamps for when the plan was created and when it finished. */
  createdAt: string;
  completedAt: string;
}

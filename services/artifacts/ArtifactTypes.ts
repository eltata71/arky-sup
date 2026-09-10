/**
 * El agregado Artefacto, y el vocabulario de su generación.
 *
 * Estaban en `types.ts`, el núcleo compartido: 249 líneas que declaraban el
 * ciclo de vida completo de una generación de IA —`ArtifactGenerationTrace`,
 * sus etapas, sus eventos de fase, el modelo efectivo que se usó— en el fichero
 * que todo módulo del repositorio puede importar sin pedir permiso.
 *
 * Un *shared kernel* debe ser pequeño e inerte: lo que de verdad comparten
 * todos los contextos. `Settings` y `MemoryEntry` lo son. El estado interno de
 * una generación de artefactos no: es el modelo de este contexto, y tenerlo
 * arriba significaba que cualquier módulo podía acoplarse a él sin que nadie lo
 * viera.
 *
 * `types.ts` lo reexporta, así que ningún llamador cambia de puerta — es el
 * mismo patrón con el que `Project`, `ChatMessage` y los tipos de revisión ya
 * viven en su contexto y se publican desde arriba.
 */

import type {
  ArchitecturalView,
  ArtifactRequestContext,
  ArtifactType,
  MemoryEntry,
} from '../../types';
import type { DiagramAudience, DiagramErrorRecord, DiagramIR, DiagramTheme } from '../../lib/diagram';
// Por el barril: es `import type`, así que no emite nada y no puede pesar en
// el chunk. `services/review` no importa este módulo, de modo que no hay ciclo.
import type { ArtifactReviewStatus } from '../review';

export type ArtifactGenerationTraceStatus = 'clean' | 'warning' | 'fallback' | 'failed';

export type ArtifactGenerationLifecycleState =
  | 'generated'
  | 'validated'
  | 'persisted-local'
  | 'persisted-remote'
  | 'opened'
  | 'render-ready'
  | 'render-fallback'
  | 'failed-recoverable'
  | 'failed-non-recoverable';

export type ArtifactGenerationStage =
  | 'recommendation'
  | 'prompt'
  | 'ai-generation'
  | 'validation'
  | 'quality-gate'
  | 'fallback'
  | 'persistence'
  | 'render'
  | 'parsing'
  | 'normalization'
  | 'export'
  | 'refinement';

export type ArtifactGenerationStepStatus =
  | 'success'
  | 'warning'
  | 'error'
  | 'skipped'
  | 'in-progress';

export interface ArtifactGenerationTraceStep {
  stage: ArtifactGenerationStage;
  status: ArtifactGenerationStepStatus;
  message: string;
  detail?: string;
  at: string;
}

/**
 * Live event emitted by the on-demand generation pipeline so the UI can show
 * a granular, observable timeline (instead of a single "loading" string).
 *
 * Phase events are intentionally non-persisted; they are intermediate progress
 * signals consumed by modals/copilots. The persisted record is built
 * separately in {@link ArtifactGenerationTrace}.
 */
export interface ArtifactGenerationPhaseEvent {
  stage: ArtifactGenerationStage;
  status: ArtifactGenerationStepStatus;
  message: string;
  detail?: string;
  /** Wall-clock timestamp when the event was emitted. */
  at: string;
  /** Optional duration in ms since the previous event of the same stage. */
  durationMs?: number;
  /** Free-form structured data (model id, content size, attempt #, etc). */
  meta?: Record<string, string | number | boolean | undefined>;
}

export type ArtifactGenerationPhaseListener = (event: ArtifactGenerationPhaseEvent) => void;

/** Where the model id came from, surfaced in the UI so reviewers can see why
 *  a particular Gemini model was used. */
export type ArtifactGenerationModelSource = 'user' | 'global' | 'tier-floor' | 'fallback';

export interface ArtifactGenerationModelEffective {
  /** Concrete id that hit the SDK (e.g. `gemini-2.5-flash-lite`). */
  id: string;
  /** Configuration layer that won precedence. */
  source: ArtifactGenerationModelSource;
  /** Tier requested by the call site. */
  tier: 'quick' | 'default' | 'deep';
  /** Original user/global preference, if any. */
  requested?: string;
}

/**
 * Records whether — and how — the Architecture Knowledge Graph was used as
 * canonical context for an artifact generation. Persisted on the artifact's
 * generation trace so reviewers can see the graph's contribution. The
 * `freshness` literal mirrors `ArchitectureGraphFreshness`.
 */
export interface ArtifactGenerationGraphUsage {
  /** True when the graph contributed a non-empty context block to the prompt. */
  used: boolean;
  /** `buildId` of the graph that was consulted. */
  buildId?: string;
  /** Freshness of the graph at generation time. */
  freshness?: 'current' | 'stale' | 'missing';
  /** Number of graph entities included in the prompt context. */
  entitiesIncluded: number;
  /** Number of graph relations included in the prompt context. */
  relationsIncluded: number;
  /** Consistency issues the graph carried at generation time. */
  consistencyIssueCount: number;
  /** Traceability gaps the graph carried at generation time. */
  traceabilityGapCount: number;
}

export interface ArtifactGenerationTrace {
  id: string;
  /** Stable end-to-end operation id shared by UI phase events, generation trace, persistence and render diagnostics. */
  operationId?: string;
  source: 'catalog' | 'on-demand' | 'regeneration' | 'unknown';
  status: ArtifactGenerationTraceStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  /** @deprecated kept for backwards compatibility — prefer `modelEffective`. */
  model?: string;
  /** The model that actually executed plus the source of that decision. */
  modelEffective?: ArtifactGenerationModelEffective;
  request?: ArtifactRequestContext;
  matchedCatalogTemplateName?: string;
  quality?: {
    score?: number;
    reachedTarget?: boolean;
    changeCount?: number;
    history?: Array<{ pass: number; score: number; changeCount: number }>;
    initialScore?: number;
    finalScore?: number;
    refinementPasses?: number;
    refinementAccepted?: boolean;
    refinementWarnings?: number;
    refinementUsedAI?: boolean;
    /** True when the pre-persistence refinement detected deterministic-fallback content. */
    refinementFallbackDetected?: boolean;
    /** Count of refined candidates discarded by the safety gate. */
    refinementRejectedCandidates?: number;
    /** Count of refinement passes that failed operationally (exceptions, AI errors). */
    refinementSafetyFailures?: number;
    /** Quality dimensions whose score improved between baseline and final content. */
    refinementImprovedDimensions?: string[];
  };
  decisions: ArtifactGenerationTraceStep[];
  errors: ArtifactGenerationTraceStep[];
  warnings?: string[];
  contentLength?: number;
  irCounters?: { nodes: number; edges: number; groups?: number };
  renderCounters?: { nodes: number; edges: number };
  lifecycle?: ArtifactGenerationLifecycleState[];
  persistence?: { local: 'pending' | 'success' | 'failed'; remote: 'pending' | 'success' | 'failed' | 'conflict' };
  contentPreview?: string;
  /**
   * Evidence that the Architecture Knowledge Graph was (or was not) used as
   * canonical context for this generation. Additive and backwards-compatible.
   */
  architectureGraph?: ArtifactGenerationGraphUsage;
}

export interface Artifact {
  id: string;
  versionGroupId: string; // To group versions of the same artifact
  version: number;
  createdAt: string;
  name: string;
  type: ArtifactType;
  phase: string;
  architecturalView: ArchitecturalView;
  content: string; // Raw content (Markdown, Mermaid syntax, YAML, JSON-deck, etc.)
  objective: string;
  keyConcepts: { term: string; definition: string; }[];
  representation: 'diagram' | 'document' | 'hybrid';
  /**
   * High-level semantic shape ('document' | 'diagram' | 'presentation' | 'hybrid').
   * Optional for backwards compatibility — legacy artifacts derive the kind
   * from `type` via `getArtifactKind`. Populated for new artifacts so the UI
   * and exporters never have to re-classify.
   */
  artifactKind?: 'document' | 'diagram' | 'presentation' | 'hybrid';
  isFavorite?: boolean;
  /** Canonical diagram IR (set once the deterministic pipeline runs). */
  ir?: DiagramIR;
  /** Optional Lucidchart document id persisted after first real integration push. */
  lucidDocumentId?: string;
  /** Declared audience for this artifact; empty means the author has not chosen yet. */
  audience?: DiagramAudience;
  /** Declared visual theme for this artifact; defaults to editorial when unset. */
  theme?: DiagramTheme;
  /** Optional cover image URL rendered on the executive one-pager. */
  coverImageUrl?: string;
  /**
   * Last diagram-generation failure recorded for this artifact. Persisted so
   * the UI can show the reason after a reload and the corrective retry can
   * cite it back to the model.
   */
  lastDiagramError?: DiagramErrorRecord;
  /** Observable generation provenance for quality review and troubleshooting. */
  generationTrace?: ArtifactGenerationTrace;
  /** Raw AI response retained for parser/render/export troubleshooting. */
  rawResponse?: string;
  /** Normalized envelope snapshot used by the resilient artifact pipeline. */
  artifactEnvelope?: import('./artifactGenerationPipeline').ArtifactEnvelope;
  /** Notas/contexto específico para este artefacto gestionados desde el Centro de Memoria. */
  artifactMemory?: string[];
  /** Metadatos estructurados (fecha, autor, prioridad) de `artifactMemory`. */
  artifactMemoryEntries?: MemoryEntry[];
  /** Current review/approval workflow status. Defaults to 'draft' on creation. */
  reviewStatus?: ArtifactReviewStatus;
  /**
   * Summary produced by the Artifact Compilation Engine: contract applied,
   * status, score, tier, issue counts, repairs, recommendations and export
   * readiness. Additive and backwards-compatible — absent on legacy artifacts.
   */
  compilation?: import('../artifactCompiler/ArtifactCompilerTypes').ArtifactCompilerSummary;
}

/**
 * Canonical artifact contracts (Phase 1 — architectural stabilization).
 *
 * This module is the single import surface for the new modular artifact
 * pipeline. It deliberately re-exports the existing domain types from
 * `types.ts` and `services/artifactGenerationPipeline.ts` under canonical
 * names, plus adds a small set of additive contracts that the extracted
 * panels, hooks and view controllers consume. Nothing here changes the
 * runtime behaviour of legacy code paths.
 *
 * Phases 2–4 will lean on this surface (quality, AI/context, UX), so keep
 * shapes additive and avoid breaking changes when extending it.
 */
import type { ArtifactType } from '../../types';
import type { Artifact, ArtifactGenerationTrace, ArtifactGenerationTraceStatus, ArtifactGenerationTraceStep } from './artifactModel';
import type { DiagramAudience, DiagramIR, DiagramTheme } from '../diagram';
import type {
  ArtifactDiagnostic as PipelineArtifactDiagnostic,
  ArtifactEnvelope as PipelineArtifactEnvelope,
  ArtifactIntent as PipelineArtifactIntent,
  ArtifactPayload as PipelineArtifactPayload,
  ArtifactPayloadKind as PipelineArtifactPayloadKind,
  ArtifactPipelineStage as PipelineArtifactPipelineStage,
  ArtifactValidationResult as PipelineArtifactValidationResult,
  ArtifactViewMode as PipelineArtifactViewMode,
} from './artifactPipelineContracts';
import type {
  ArtifactValidationResult as ExportArtifactValidationResult,
  ArtifactView as ExportArtifactView,
  ExportCapability,
  ExportFormat,
  ExportTrace,
  ExportedFile,
} from './exportContracts';

// ─── Re-exported canonical types ──────────────────────────────────────────

export type ArtifactEnvelope = PipelineArtifactEnvelope;
export type ArtifactDiagnostic = PipelineArtifactDiagnostic;
export type ArtifactIntent = PipelineArtifactIntent;
export type ArtifactPayload = PipelineArtifactPayload;
export type ArtifactPayloadKind = PipelineArtifactPayloadKind;
export type ArtifactPipelineStage = PipelineArtifactPipelineStage;
export type ArtifactViewMode = PipelineArtifactViewMode;
export type GenerationTrace = ArtifactGenerationTrace;
export type GenerationTraceStatus = ArtifactGenerationTraceStatus;
export type GenerationTraceStep = ArtifactGenerationTraceStep;
export type { DiagramIR, DiagramAudience, DiagramTheme };

// ─── Display-layer projections ────────────────────────────────────────────

/**
 * UI-ready projection of an artifact. Components (DocumentView, DiagramView,
 * panels) should consume this rather than touching the raw `Artifact` so we
 * can evolve the underlying schema without rippling through every renderer.
 */
export interface ArtifactViewModel {
  id: string;
  name: string;
  type: ArtifactType;
  representation: Artifact['representation'];
  audience: DiagramAudience;
  theme: DiagramTheme;
  content: string;
  hasIR: boolean;
  hasDiagram: boolean;
  hasDocument: boolean;
  hasMermaid: boolean;
  hasMarkdown: boolean;
  trace?: GenerationTrace;
  envelope?: ArtifactEnvelope;
  lastDiagramError?: Artifact['lastDiagramError'];
}

/** Status the diagram view can be in at any moment. */
export type ArtifactDiagramRenderStatus =
  | 'idle'
  | 'loading'
  | 'rendered'
  | 'rendered-with-fallback'
  | 'invalid'
  | 'empty';

/** Status the document view can be in at any moment. */
export type ArtifactDocumentRenderStatus =
  | 'idle'
  | 'rendered'
  | 'empty'
  | 'invalid';

/**
 * Snapshot of the render layer at any point in time. The hosts (panels,
 * fallbacks) read this to display recovery actions consistently.
 */
export interface ArtifactRenderState {
  viewMode: ArtifactViewMode;
  diagram: {
    status: ArtifactDiagramRenderStatus;
    nodeCount: number;
    edgeCount: number;
    source: string;
    fallbackUsed: boolean;
    lastError?: string;
  };
  document: {
    status: ArtifactDocumentRenderStatus;
    htmlLength: number;
    hasMarkdownSource: boolean;
  };
  diagnostics: ArtifactDiagnostic[];
}

// ─── Validation ───────────────────────────────────────────────────────────

/**
 * Reuse the rich export-validation result as the canonical validation state
 * for now; phases 2+ can add document-specific gates that compose with it.
 */
export type ArtifactValidationState = ExportArtifactValidationResult;
export type { ExportArtifactView as ArtifactView };

// ─── Persistence ──────────────────────────────────────────────────────────

export type ArtifactPersistenceChannel = 'local' | 'remote';
export type ArtifactPersistenceStatus =
  | 'idle'
  | 'pending'
  | 'success'
  | 'failed'
  | 'conflict';

export interface ArtifactPersistenceState {
  local: ArtifactPersistenceStatus;
  remote: ArtifactPersistenceStatus;
  lastSyncAt?: string;
  lastError?: string;
}

// ─── Document IR (preliminary) ────────────────────────────────────────────

/**
 * Minimal document intermediate representation. Phase 2 will expand this with
 * scoring dimensions, table-aware blocks, and audience projection — keeping
 * the shape additive ensures existing consumers won't break.
 */
export type DocumentBlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'code'
  | 'callout'
  | 'mermaid'
  | 'raw';

export interface DocumentBlock {
  kind: DocumentBlockKind;
  /** Heading depth (1–6); only present when `kind === 'heading'`. */
  level?: number;
  /** Raw text content of the block (Markdown source). */
  text: string;
  /** Index into the original markdown string for traceability. */
  sourceOffset?: number;
}

export interface DocumentIR {
  title?: string;
  blocks: DocumentBlock[];
  hasFrontMatter: boolean;
  tableCount: number;
  mermaidBlockCount: number;
  warnings: string[];
}

// ─── Export contracts ─────────────────────────────────────────────────────

export type { ExportFormat, ExportCapability };

export interface ExportRequest {
  artifact: Artifact;
  activeView: ExportArtifactView;
  format: ExportFormat;
  /** Optional operation id; lets us correlate with generation/render traces. */
  operationId?: string;
  /** Optional rendered HTML cache for document exports. */
  renderedHtml?: string;
}

export interface ExportResult {
  file: ExportedFile;
  trace: ExportTrace;
  /** Mirrors the trace operation id so callers don't have to drill in. */
  operationId?: string;
}

// ─── Pipeline validation ──────────────────────────────────────────────────

export type ArtifactPipelineValidation = PipelineArtifactValidationResult;

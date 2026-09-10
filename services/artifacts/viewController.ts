/**
 * ArtifactViewController
 *
 * Pure functions that the canvas + hooks use to:
 *   1. derive a stable {@link ArtifactRenderState} from the raw artifact +
 *      renderable resolution result;
 *   2. decide which view is safe to show for the user's request (without
 *      ever returning a viewMode the artifact cannot render).
 *
 * Keeping this logic in its own module lets us:
 *   - unit-test view selection without mounting React;
 *   - share the same "safe view" semantics across ArtifactCanvas, command
 *     palette routing, and Phase 4 workspace shells.
 */
import type { Artifact } from '../../types';
import type {
  ArtifactDiagramRenderStatus,
  ArtifactDocumentRenderStatus,
  ArtifactRenderState,
  ArtifactViewMode,
  ArtifactViewModel,
} from '../../lib/artifacts/contracts';
import {
  getArtifactViewCapabilities as pipelineGetCapabilities,
  resolveSafeArtifactView as pipelineResolveSafeView,
  type ArtifactViewCapabilities,
} from './artifactGenerationPipeline';
import { extractMermaid } from '../../utils/diagram/extractMermaid';

export type { ArtifactViewCapabilities };

export const getArtifactViewCapabilities = pipelineGetCapabilities;

/**
 * Returns the requested view if the artifact can render it, otherwise the
 * artifact's preferred view. Never returns a view that would produce an
 * empty canvas (Phase 1 anti-regression guarantee).
 */
export const resolveSafeArtifactView = (artifact: Artifact, requested: ArtifactViewMode): ArtifactViewMode =>
  pipelineResolveSafeView(artifact, requested);

/**
 * Lightweight UI projection of an artifact. Components should consume this
 * rather than touch the raw {@link Artifact} so future schema changes stay
 * isolated.
 */
export const buildArtifactViewModel = (artifact: Artifact): ArtifactViewModel => {
  const content = artifact.content ?? '';
  const mermaidProbe = extractMermaid(content, artifact.representation);
  const hasMermaid = 'code' in mermaidProbe && mermaidProbe.code.trim().length > 0;
  const hasMarkdown = /(^|\n)#{1,6}\s+|```|\|.+\|\n\|?\s*:?-{3,}/.test(content);
  const hasIR = Boolean(artifact.ir && Array.isArray(artifact.ir.nodes) && artifact.ir.nodes.length > 0);
  const representation = artifact.representation;
  const hasDiagram = hasIR || hasMermaid || representation === 'diagram' || representation === 'hybrid';
  const hasDocument = content.trim().length > 0 && (representation !== 'diagram' || hasMarkdown);

  return {
    id: artifact.id,
    name: artifact.name,
    type: artifact.type,
    representation,
    audience: artifact.audience ?? 'technical',
    theme: artifact.theme ?? 'editorial',
    content,
    hasIR,
    hasDiagram,
    hasDocument,
    hasMermaid,
    hasMarkdown,
    trace: artifact.generationTrace,
    envelope: artifact.artifactEnvelope,
    lastDiagramError: artifact.lastDiagramError,
  };
};

// ─── Render-state derivation ──────────────────────────────────────────────

export interface DeriveDiagramRenderStateInput {
  isLoading: boolean;
  error: string | null;
  nodeCount: number;
  edgeCount: number;
  fallbackUsed: boolean;
  source?: string;
}

export const deriveDiagramRenderStatus = (input: DeriveDiagramRenderStateInput): ArtifactDiagramRenderStatus => {
  if (input.isLoading) return 'loading';
  if (input.error && input.nodeCount === 0) return 'invalid';
  if (input.nodeCount === 0) return 'empty';
  if (input.fallbackUsed) return 'rendered-with-fallback';
  return 'rendered';
};

export interface DeriveDocumentRenderStateInput {
  htmlLength: number;
  contentLength: number;
}

export const deriveDocumentRenderStatus = (input: DeriveDocumentRenderStateInput): ArtifactDocumentRenderStatus => {
  if (input.contentLength === 0) return 'empty';
  if (input.htmlLength === 0) return 'idle';
  return 'rendered';
};

export interface BuildArtifactRenderStateInput {
  viewMode: ArtifactViewMode;
  diagram: DeriveDiagramRenderStateInput;
  document: DeriveDocumentRenderStateInput;
  hasMarkdownSource: boolean;
  diagnostics?: ArtifactRenderState['diagnostics'];
}

export const buildArtifactRenderState = (input: BuildArtifactRenderStateInput): ArtifactRenderState => ({
  viewMode: input.viewMode,
  diagram: {
    status: deriveDiagramRenderStatus(input.diagram),
    nodeCount: input.diagram.nodeCount,
    edgeCount: input.diagram.edgeCount,
    source: input.diagram.source ?? 'unknown',
    fallbackUsed: input.diagram.fallbackUsed,
    lastError: input.diagram.error ?? undefined,
  },
  document: {
    status: deriveDocumentRenderStatus(input.document),
    htmlLength: input.document.htmlLength,
    hasMarkdownSource: input.hasMarkdownSource,
  },
  diagnostics: input.diagnostics ?? [],
});

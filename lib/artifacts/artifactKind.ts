/**
 * Artifact Kind classification — the canonical answer to:
 *   "What is the high-level semantic shape of this artifact?"
 *
 * Until now the codebase derived everything from the long `ArtifactType` union
 * (e.g. `mermaid-c4-context`, `presentation-executive`, `markdown`). That works
 * for the generation prompt but is too granular for everything else: the canvas
 * needs to pick a viewer, the exporter needs to pick a default format, and
 * quality validation needs to know whether the artifact must contain a diagram.
 *
 * `ArtifactKind` is the small, stable contract those layers consume:
 *
 *   - `document`     — plain prose (Markdown / YAML / SDD docs)
 *   - `diagram`      — pure visual artifact (Mermaid / ReactFlow)
 *   - `presentation` — slide deck (executive, technical, summary, overview)
 *   - `hybrid`       — text + diagram in one artifact
 *
 * This module is intentionally side-effect-free and dependency-light so
 * everything from the generator to the canvas to the export modal can ask
 * the same question and get the same answer.
 */
import type { ArtifactType } from '../../types';
import type { ExportFormat } from './exportContracts';

export type ArtifactKind = 'document' | 'diagram' | 'presentation' | 'hybrid';

/**
 * Coarse-grained output container shape implied by the artifact kind.
 * Surfaced in `ArtifactTemplate.outputFormat` so downstream tooling can route
 * without re-deriving from `type`.
 */
export type ArtifactOutputFormat = 'doc' | 'diagram' | 'deck' | 'markdown' | 'mixed';

/** Identifies the renderer responsible for the artifact on the canvas. */
export type ArtifactRenderingMode =
  | 'documentViewer'
  | 'diagramViewer'
  | 'slideViewer'
  | 'hybridViewer';

/**
 * Every `ArtifactType` value that maps to a presentation deck. New presentation
 * types should be added here AND to `getArtifactKind` below.
 */
export const PRESENTATION_ARTIFACT_TYPES = new Set<string>([
  'presentation-executive',
  'presentation-technical',
  'presentation-summary',
  'presentation-overview',
]);

export const isPresentationArtifactType = (type: ArtifactType | string): boolean =>
  PRESENTATION_ARTIFACT_TYPES.has(type);

export const isDiagramArtifactType = (type: ArtifactType | string): boolean => {
  return type.startsWith('mermaid') || type === 'react-flow-graph';
};

export const isHybridArtifactType = (type: ArtifactType | string): boolean => {
  return type === 'hybrid-text-diagram';
};

/**
 * Map an `ArtifactType` to its high-level `ArtifactKind`.
 * Falls back to `document` so unknown future types degrade gracefully.
 */
export const getArtifactKind = (type: ArtifactType | string): ArtifactKind => {
  if (isPresentationArtifactType(type)) return 'presentation';
  if (isHybridArtifactType(type)) return 'hybrid';
  if (isDiagramArtifactType(type)) return 'diagram';
  return 'document';
};

/** Default container shape implied by an `ArtifactKind`. */
export const getArtifactOutputFormat = (kind: ArtifactKind): ArtifactOutputFormat => {
  switch (kind) {
    case 'presentation': return 'deck';
    case 'diagram': return 'diagram';
    case 'hybrid': return 'mixed';
    case 'document': return 'doc';
  }
};

/** Default rendering mode used by the canvas for an `ArtifactKind`. */
export const getArtifactRenderingMode = (kind: ArtifactKind): ArtifactRenderingMode => {
  switch (kind) {
    case 'presentation': return 'slideViewer';
    case 'diagram': return 'diagramViewer';
    case 'hybrid': return 'hybridViewer';
    case 'document': return 'documentViewer';
  }
};

/**
 * The preferred export formats for each kind. The export modal uses this to
 * promote the right defaults (e.g. PPTX for presentations, DOCX for documents)
 * and to filter out formats that should never be the "main" export of a kind
 * (e.g. DOCX should never lead the export options of a slide deck).
 */
export const PRESENTATION_PREFERRED_EXPORTS: readonly ExportFormat[] = ['pptx', 'pdf', 'html', 'json'];
export const DOCUMENT_PREFERRED_EXPORTS: readonly ExportFormat[] = ['docx', 'pdf', 'md', 'html'];
export const DIAGRAM_PREFERRED_EXPORTS: readonly ExportFormat[] = ['png', 'svg', 'mermaid', 'diagram-json'];
export const HYBRID_PREFERRED_EXPORTS: readonly ExportFormat[] = ['pdf', 'docx', 'md', 'html'];

export const getPreferredExports = (kind: ArtifactKind): readonly ExportFormat[] => {
  switch (kind) {
    case 'presentation': return PRESENTATION_PREFERRED_EXPORTS;
    case 'diagram': return DIAGRAM_PREFERRED_EXPORTS;
    case 'hybrid': return HYBRID_PREFERRED_EXPORTS;
    case 'document': return DOCUMENT_PREFERRED_EXPORTS;
  }
};

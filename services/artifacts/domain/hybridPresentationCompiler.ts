import type { Artifact } from '../../../lib/artifacts';
import type { MarkdownPresentationParts } from './markdownPresentationCompiler';
import type { DiagramPresentationParts } from './diagramPresentationCompiler';

export interface HybridPresentationParts extends MarkdownPresentationParts, DiagramPresentationParts {}

export const mergeHybridPresentationParts = (
  markdown: MarkdownPresentationParts,
  diagram: DiagramPresentationParts,
): HybridPresentationParts => ({
  ...markdown,
  diagrams: diagram.diagrams,
  callouts: diagram.callouts,
  warnings: [...markdown.warnings, ...diagram.warnings],
});

export const isHybridArtifact = (artifact: Artifact): boolean =>
  artifact.representation === 'hybrid' || artifact.type === 'hybrid-text-diagram';

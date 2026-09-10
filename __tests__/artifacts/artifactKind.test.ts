import { describe, expect, it } from 'vitest';
import {
  getArtifactKind,
  getArtifactOutputFormat,
  getArtifactRenderingMode,
  getPreferredExports,
  isPresentationArtifactType,
  isDiagramArtifactType,
  isHybridArtifactType,
  PRESENTATION_PREFERRED_EXPORTS,
  DOCUMENT_PREFERRED_EXPORTS,
  DIAGRAM_PREFERRED_EXPORTS,
} from '../../lib/artifacts/artifactKind';

describe('artifactKind', () => {
  it('classifies presentation types as presentation', () => {
    expect(getArtifactKind('presentation-executive')).toBe('presentation');
    expect(getArtifactKind('presentation-technical')).toBe('presentation');
    expect(getArtifactKind('presentation-overview')).toBe('presentation');
    expect(getArtifactKind('presentation-summary')).toBe('presentation');
  });

  it('classifies diagram types as diagram', () => {
    expect(getArtifactKind('mermaid-c4-context')).toBe('diagram');
    expect(getArtifactKind('mermaid-graph')).toBe('diagram');
    expect(getArtifactKind('react-flow-graph')).toBe('diagram');
  });

  it('classifies hybrid-text-diagram as hybrid', () => {
    expect(getArtifactKind('hybrid-text-diagram')).toBe('hybrid');
  });

  it('classifies markdown / yaml / sdd-* as document', () => {
    expect(getArtifactKind('markdown')).toBe('document');
    expect(getArtifactKind('yaml')).toBe('document');
    expect(getArtifactKind('sdd-brd')).toBe('document');
    expect(getArtifactKind('sdd-use-case')).toBe('document');
  });

  it('returns sensible output formats per kind', () => {
    expect(getArtifactOutputFormat('presentation')).toBe('deck');
    expect(getArtifactOutputFormat('diagram')).toBe('diagram');
    expect(getArtifactOutputFormat('document')).toBe('doc');
    expect(getArtifactOutputFormat('hybrid')).toBe('mixed');
  });

  it('returns the right rendering mode per kind', () => {
    expect(getArtifactRenderingMode('presentation')).toBe('slideViewer');
    expect(getArtifactRenderingMode('diagram')).toBe('diagramViewer');
    expect(getArtifactRenderingMode('document')).toBe('documentViewer');
    expect(getArtifactRenderingMode('hybrid')).toBe('hybridViewer');
  });

  it('promotes PPTX as the first preferred export for presentations', () => {
    expect(getPreferredExports('presentation')[0]).toBe('pptx');
    expect(PRESENTATION_PREFERRED_EXPORTS).toContain('pptx');
    expect(PRESENTATION_PREFERRED_EXPORTS).toContain('pdf');
    expect(PRESENTATION_PREFERRED_EXPORTS).not.toContain('docx');
  });

  it('does NOT promote PPTX for documents/diagrams', () => {
    expect(DOCUMENT_PREFERRED_EXPORTS).not.toContain('pptx');
    expect(DIAGRAM_PREFERRED_EXPORTS).not.toContain('pptx');
  });

  it('exposes type-checking helpers consistent with kind classification', () => {
    expect(isPresentationArtifactType('presentation-executive')).toBe(true);
    expect(isPresentationArtifactType('markdown')).toBe(false);
    expect(isDiagramArtifactType('mermaid-graph')).toBe(true);
    expect(isDiagramArtifactType('presentation-executive')).toBe(false);
    expect(isHybridArtifactType('hybrid-text-diagram')).toBe(true);
    expect(isHybridArtifactType('markdown')).toBe(false);
  });
});

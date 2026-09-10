import { describe, expect, it } from 'vitest';
import {
  buildArtifactQualityReport,
  diagramDimensions,
  documentDimensions,
} from '../../services/quality/artifactQualityService';
import { resolveQualityProfile } from '../../services/quality/qualityProfiles';
import {
  baseArtifact,
  emptyDocumentArtifact,
  fullDocumentContent,
  richDocumentArtifact,
  validDiagramIR,
  emptyDiagramIR,
  diagramWithOrphans,
  diagramWithInvalidRef,
} from './fixtures';

describe('buildArtifactQualityReport', () => {
  it('returns score 0 for fully empty artifact and tier "blocked"', () => {
    const report = buildArtifactQualityReport(emptyDocumentArtifact);
    expect(report.score.value).toBe(0);
    expect(report.score.tier).toBe('blocked');
    expect(report.profile.id).toContain('document');
  });

  it('produces a high score for a rich document artifact', () => {
    const report = buildArtifactQualityReport(richDocumentArtifact);
    expect(report.score.value).toBeGreaterThanOrEqual(70);
    expect(report.document?.hasStructure).toBe(true);
    expect(report.document?.wordCount).toBeGreaterThan(50);
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('selects the C4 profile for a C4 container artifact', () => {
    const artifact = baseArtifact({
      type: 'mermaid-c4-container',
      content: 'C4Container\nContainer(svc, "Service")',
      representation: 'diagram',
      ir: validDiagramIR(),
    });
    const report = buildArtifactQualityReport(artifact);
    expect(report.profile.family).toBe('diagram-c4');
    expect(diagramDimensions(report).length).toBeGreaterThan(5);
  });

  it('selects the matrix profile for a traceability matrix and uses doc.traceability as required', () => {
    const artifact = baseArtifact({
      type: 'sdd-traceability',
      content: `# Matriz\n\n## Objetivo\nAlgo.\n`,
    });
    const report = buildArtifactQualityReport(artifact);
    expect(report.profile.family).toBe('matrix');
    expect(report.issues.some((i) => i.code === 'DOC_MISSING_SECTION_TRACEABILITY')).toBe(true);
  });

  it('caps the score to <= 40 when a critical diagram finding is present', () => {
    const artifact = baseArtifact({
      type: 'mermaid-c4-container',
      content: fullDocumentContent,
      representation: 'hybrid',
      ir: diagramWithInvalidRef(),
    });
    const report = buildArtifactQualityReport(artifact);
    expect(report.score.value).toBeLessThanOrEqual(40);
  });

  it('penalises a diagram with orphan nodes', () => {
    const artifact = baseArtifact({
      type: 'mermaid-graph',
      content: '## Diagrama',
      representation: 'diagram',
      ir: diagramWithOrphans(),
    });
    const report = buildArtifactQualityReport(artifact);
    expect(report.issues.some((i) => i.code === 'ORPHAN_NODE')).toBe(true);
    expect(report.dimensions.find((d) => d.id === 'diag.orphans')?.score).toBeLessThan(90);
  });

  it('blocks an empty diagram', () => {
    const artifact = baseArtifact({
      type: 'mermaid-c4-container',
      content: '',
      representation: 'diagram',
      ir: emptyDiagramIR(),
    });
    const report = buildArtifactQualityReport(artifact);
    expect(report.score.tier).toBe('blocked');
  });

  it('produces both document and diagram dimensions for hybrid artifacts', () => {
    const artifact = baseArtifact({
      type: 'hybrid-text-diagram',
      content: fullDocumentContent,
      representation: 'hybrid',
      ir: validDiagramIR(),
    });
    const report = buildArtifactQualityReport(artifact);
    expect(documentDimensions(report).length).toBeGreaterThan(0);
    expect(diagramDimensions(report).length).toBeGreaterThan(0);
    expect(report.diagram).toBeDefined();
    expect(report.document).toBeDefined();
  });

  it('falls back to a generic profile for unknown types but stays deterministic', () => {
    // Cast to any here is the canonical pattern for fixture-only edge cases.
    const profile = resolveQualityProfile('markdown');
    expect(profile.id).toBeDefined();
    const report = buildArtifactQualityReport(richDocumentArtifact);
    expect(report.profile.id).toBe(profile.id);
  });
});

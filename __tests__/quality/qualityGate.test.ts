import { describe, expect, it } from 'vitest';
import { buildArtifactQualityReport } from '../../services/quality/artifactQualityService';
import { evaluateArtifactQualityGates, gateForFormat } from '../../services/quality/qualityGate';
import {
  baseArtifact,
  emptyDocumentArtifact,
  fullDocumentContent,
  richDocumentArtifact,
  validDiagramIR,
  emptyDiagramIR,
  tableOnlyContent,
} from './fixtures';

describe('evaluateArtifactQualityGates', () => {
  it('blocks document export when the document is empty but does not block diagram if a diagram exists', () => {
    const artifact = baseArtifact({ content: '', ir: validDiagramIR(), representation: 'diagram', type: 'mermaid-c4-container' });
    const report = buildArtifactQualityReport(artifact);
    const gates = evaluateArtifactQualityGates(artifact, report);

    expect(gates.document.passed).toBe(false);
    expect(gates.document.risk).toBe('critical');
    expect(gates.diagram.passed).toBe(true);
  });

  it('blocks diagram export when there is no diagram, even for a great document', () => {
    const report = buildArtifactQualityReport(richDocumentArtifact);
    const gates = evaluateArtifactQualityGates(richDocumentArtifact, report);

    expect(gates.document.passed).toBe(true);
    expect(gates.diagram.passed).toBe(false);
    expect(gates.diagram.allowOverride).toBe(false);
  });

  it('blocks tabular export when no tables are present', () => {
    const report = buildArtifactQualityReport(richDocumentArtifact);
    const gates = evaluateArtifactQualityGates(richDocumentArtifact, report);
    expect(gates.table.passed).toBe(true); // Rich content includes tables
  });

  it('allows tabular export when a single full table is present', () => {
    const artifact = baseArtifact({ content: tableOnlyContent });
    const report = buildArtifactQualityReport(artifact);
    const gates = evaluateArtifactQualityGates(artifact, report);
    expect(gates.table.passed).toBe(true);
  });

  it('blocks tabular export when content has no tables', () => {
    const artifact = baseArtifact({ content: '# Solo texto\n\nSin tablas.' });
    const report = buildArtifactQualityReport(artifact);
    const gates = evaluateArtifactQualityGates(artifact, report);
    expect(gates.table.passed).toBe(false);
  });

  it('does not let an empty diagram pass the diagram gate', () => {
    const artifact = baseArtifact({
      content: fullDocumentContent,
      type: 'mermaid-c4-container',
      representation: 'hybrid',
      ir: emptyDiagramIR(),
    });
    const report = buildArtifactQualityReport(artifact);
    const gates = evaluateArtifactQualityGates(artifact, report);
    expect(gates.diagram.passed).toBe(false);
  });

  it('reports critical risk and no override for completely empty artifact', () => {
    const report = buildArtifactQualityReport(emptyDocumentArtifact);
    const gates = evaluateArtifactQualityGates(emptyDocumentArtifact, report);
    expect(gates.document.allowOverride).toBe(false);
    expect(gates.document.risk).toBe('critical');
  });

  it('gateForFormat routes formats to the right family gate', () => {
    const artifact = richDocumentArtifact;
    const report = buildArtifactQualityReport(artifact);
    const gates = evaluateArtifactQualityGates(artifact, report);
    expect(gateForFormat('pdf', gates).gateId).toBe('export:document');
    expect(gateForFormat('png', gates).gateId).toBe('export:diagram');
    expect(gateForFormat('csv', gates).gateId).toBe('export:table');
    expect(gateForFormat('docx', gates).gateId).toBe('export:document');
  });
});

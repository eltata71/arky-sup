import { describe, expect, it } from 'vitest';
import {
  buildArtifactExportabilityState,
  evaluateExportQualityGate,
  canExportWithQualityGate,
  buildQualityGateMessage,
  mapQualityIssuesToExportChecks,
  exportFamilyForFormat,
} from '../../services/quality/artifactQualityGateService';
import { buildArtifactQualityReport } from '../../services/quality/artifactQualityService';
import {
  baseArtifact,
  emptyDocumentArtifact,
  fullDocumentContent,
  richDocumentArtifact,
  validDiagramIR,
  emptyDiagramIR,
  tableOnlyContent,
} from './fixtures';

const partialTableContent = `# Datos parciales

| Campo | Tipo | Notas |
|---|---|---|
| nombre | texto |  |
| edad |  |  |
`;

describe('artifactQualityGateService', () => {
  it('routes formats to the right export family', () => {
    expect(exportFamilyForFormat('docx')).toBe('document');
    expect(exportFamilyForFormat('pdf')).toBe('document');
    expect(exportFamilyForFormat('png')).toBe('diagram');
    expect(exportFamilyForFormat('mermaid')).toBe('diagram');
    expect(exportFamilyForFormat('csv')).toBe('table');
    expect(exportFamilyForFormat('xlsx')).toBe('table');
  });

  it('lets a document export proceed even when there is no diagram', () => {
    const { state } = buildArtifactExportabilityState(richDocumentArtifact);
    expect(state.document.passed).toBe(true);
    const docGate = evaluateExportQualityGate(buildArtifactQualityReport(richDocumentArtifact), 'docx');
    expect(docGate.passed).toBe(true);
  });

  it('blocks a diagram export when the diagram has no nodes', () => {
    const artifact = baseArtifact({
      type: 'mermaid-c4-container',
      representation: 'diagram',
      content: '',
      ir: emptyDiagramIR(),
    });
    const report = buildArtifactQualityReport(artifact);
    const gate = evaluateExportQualityGate(report, 'png');
    expect(gate.passed).toBe(false);
    expect(gate.risk).toBe('critical');
    expect(gate.allowOverride).toBe(false);
  });

  it('keeps a hybrid exportable as a document even if its diagram fails', () => {
    const artifact = baseArtifact({
      type: 'hybrid-text-diagram',
      representation: 'hybrid',
      content: fullDocumentContent,
      ir: emptyDiagramIR(),
    });
    const report = buildArtifactQualityReport(artifact);
    expect(evaluateExportQualityGate(report, 'docx').passed).toBe(true);
    expect(evaluateExportQualityGate(report, 'pdf').passed).toBe(true);
  });

  it('blocks a hybrid PNG export when the diagram fails', () => {
    const artifact = baseArtifact({
      type: 'hybrid-text-diagram',
      representation: 'hybrid',
      content: fullDocumentContent,
      ir: emptyDiagramIR(),
    });
    const report = buildArtifactQualityReport(artifact);
    expect(evaluateExportQualityGate(report, 'png').passed).toBe(false);
  });

  it('allows a data dictionary with a full table to export as XLSX', () => {
    const artifact = baseArtifact({ content: tableOnlyContent });
    const report = buildArtifactQualityReport(artifact);
    const gate = evaluateExportQualityGate(report, 'xlsx');
    expect(gate.passed).toBe(true);
  });

  it('blocks CSV/XLSX for a matrix that has no tabular structure', () => {
    const artifact = baseArtifact({
      type: 'sdd-traceability',
      content: '# Matriz de trazabilidad\n\n## Objetivo\nGarantizar cobertura.\n',
    });
    const report = buildArtifactQualityReport(artifact);
    expect(evaluateExportQualityGate(report, 'csv').passed).toBe(false);
    expect(evaluateExportQualityGate(report, 'xlsx').passed).toBe(false);
  });

  it('allows export with an override when the risk is medium (partial table)', () => {
    const artifact = baseArtifact({ content: partialTableContent });
    const report = buildArtifactQualityReport(artifact);
    const gate = evaluateExportQualityGate(report, 'xlsx');
    expect(gate.passed).toBe(true);
    expect(gate.risk).toBe('medium');
    expect(gate.allowOverride).toBe(true);
    expect(gate.warnings.length).toBeGreaterThan(0);
  });

  it('blocks export with critical risk and no override for an empty artifact', () => {
    const report = buildArtifactQualityReport(emptyDocumentArtifact);
    const gate = evaluateExportQualityGate(report, 'docx');
    expect(gate.passed).toBe(false);
    expect(gate.risk).toBe('critical');
    expect(gate.allowOverride).toBe(false);
  });

  it('canExportWithQualityGate reports allowed + override needs', () => {
    const ok = canExportWithQualityGate(richDocumentArtifact, 'docx', 'document');
    expect(ok.allowed).toBe(true);

    const blocked = canExportWithQualityGate(emptyDocumentArtifact, 'docx', 'document');
    expect(blocked.allowed).toBe(false);

    const overridable = canExportWithQualityGate(baseArtifact({ content: partialTableContent }), 'xlsx', 'table');
    expect(overridable.allowed).toBe(true);
    expect(overridable.requiresOverride).toBe(true);
  });

  it('buildQualityGateMessage summarises blockers and warnings', () => {
    const blockedReport = buildArtifactQualityReport(emptyDocumentArtifact);
    const blockedGate = evaluateExportQualityGate(blockedReport, 'docx');
    expect(buildQualityGateMessage(blockedGate)).toMatch(/vacío/i);

    const cleanReport = buildArtifactQualityReport(richDocumentArtifact);
    const cleanGate = evaluateExportQualityGate(cleanReport, 'docx');
    expect(buildQualityGateMessage(cleanGate).length).toBeGreaterThan(0);
  });

  it('maps quality issues onto export validation checks', () => {
    const report = buildArtifactQualityReport(emptyDocumentArtifact);
    const gate = evaluateExportQualityGate(report, 'docx');
    const checks = mapQualityIssuesToExportChecks(report, gate);
    expect(checks.some((c) => c.status === 'fail')).toBe(true);

    const cleanReport = buildArtifactQualityReport(richDocumentArtifact);
    const cleanGate = evaluateExportQualityGate(cleanReport, 'docx');
    const cleanChecks = mapQualityIssuesToExportChecks(cleanReport, cleanGate);
    expect(cleanChecks.every((c) => c.status === 'pass' || c.status === 'warn')).toBe(true);
  });

  it('builds a per-family exportability state for a valid diagram', () => {
    const artifact = baseArtifact({
      type: 'mermaid-c4-container',
      representation: 'diagram',
      content: 'C4Container\nContainer(svc, "Service")',
      ir: validDiagramIR(),
    });
    const { state } = buildArtifactExportabilityState(artifact);
    expect(state.diagram.passed).toBe(true);
  });
});

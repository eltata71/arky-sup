import { describe, expect, it } from 'vitest';
import type { ArtifactType } from '../../types';
import {
  getContractById,
  listContracts,
  resolveContract,
} from '../../services/artifactCompiler';

describe('ArtifactContractRegistry', () => {
  it('resolves explicit document and SDD contracts by type', () => {
    expect(resolveContract('markdown').id).toBe('contract.document.markdown');
    expect(resolveContract('yaml').id).toBe('contract.document.yaml');
    expect(resolveContract('hybrid-text-diagram').id).toBe('contract.hybrid.text-diagram');
    expect(resolveContract('presentation-executive').id).toBe('contract.presentation.executive');
    expect(resolveContract('sdd-brd').id).toBe('contract.sdd.brd');
    expect(resolveContract('sdd-use-case').id).toBe('contract.sdd.use-case');
    expect(resolveContract('sdd-nfr').id).toBe('contract.sdd.nfr');
    expect(resolveContract('sdd-bdd').id).toBe('contract.sdd.bdd');
    expect(resolveContract('sdd-traceability').id).toBe('contract.sdd.traceability');
  });

  it('resolves every mermaid-* type to the pattern-matched diagram contract', () => {
    const mermaidTypes: ArtifactType[] = [
      'mermaid-c4-context',
      'mermaid-c4-container',
      'mermaid-erd',
      'mermaid-sequence',
      'mermaid-graph',
      'mermaid-gantt',
    ];
    for (const type of mermaidTypes) {
      const contract = resolveContract(type);
      expect(contract.id).toBe('contract.diagram.mermaid');
      expect(contract.representation).toBe('diagram');
      expect(contract.delegatesToDiagramGate).toBe(true);
    }
  });

  it('resolves react-flow-graph to its own diagram contract', () => {
    const contract = resolveContract('react-flow-graph');
    expect(contract.id).toBe('contract.diagram.react-flow');
    expect(contract.delegatesToDiagramGate).toBe(true);
  });

  it('falls back deterministically for unknown artifact types', () => {
    expect(resolveContract('some-future-type' as ArtifactType).id).toBe('contract.document.fallback');
    expect(resolveContract('mermaid-future' as ArtifactType).id).toBe('contract.diagram.mermaid');
  });

  it('looks contracts up by id and lists all registered contracts', () => {
    expect(getContractById('contract.sdd.brd')?.label).toContain('BRD');
    expect(getContractById('contract.unknown-id')).toBeUndefined();
    expect(listContracts().length).toBe(16);
  });

  it('keeps the section + threshold shape consistent on every contract', () => {
    for (const contract of listContracts()) {
      expect(contract.thresholds.exportFloor).toBeLessThanOrEqual(contract.thresholds.recommended);
      for (const section of contract.sections) {
        expect(section.keywords.length).toBeGreaterThan(0);
      }
    }
  });
});

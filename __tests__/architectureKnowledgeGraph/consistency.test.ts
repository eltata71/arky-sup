import { describe, expect, it } from 'vitest';
import {
  analyzeArchitectureConsistency,
  buildArchitectureKnowledgeGraph,
} from '../../services/architectureKnowledgeGraph';
import { NOW, fullBuildInput } from './fixtures';

describe('ArchitectureConsistencyService', () => {
  it('detects risks without a mitigation', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    const report = analyzeArchitectureConsistency(graph, fullBuildInput.artifacts ?? []);
    expect(report.issues.some((i) => i.type === 'risk-without-mitigation')).toBe(true);
  });

  it('detects integrations declared without a protocol', () => {
    const graph = buildArchitectureKnowledgeGraph({
      projectId: 'p',
      now: NOW,
      artifacts: [
        {
          id: 'art-int',
          name: 'Integraciones',
          type: 'mermaid-c4-container',
          ir: {
            nodes: [
              { id: 'g', label: 'Gateway de Pagos', kind: 'api' },
              { id: 's', label: 'Servicio Externo de Cobros', kind: 'System_Ext' },
            ],
            edges: [{ id: 'e', source: 'g', target: 's', relation: 'sync' }],
            groups: [],
          },
        },
      ],
    });
    const report = analyzeArchitectureConsistency(graph);
    expect(report.issues.some((i) => i.type === 'integration-without-protocol')).toBe(true);
  });

  it('detects APIs documented but missing from any diagram', () => {
    const graph = buildArchitectureKnowledgeGraph({
      projectId: 'p',
      now: NOW,
      artifacts: [
        {
          id: 'art-doc',
          name: 'Especificación',
          type: 'sdd-brd',
          content: 'La API de Facturación expone los endpoints de cobro.',
        },
      ],
    });
    const report = analyzeArchitectureConsistency(graph);
    expect(report.issues.some((i) => i.type === 'api-not-in-diagram')).toBe(true);
  });

  it('reports artifacts that contribute nothing to the graph (low coverage)', () => {
    const report = analyzeArchitectureConsistency(
      buildArchitectureKnowledgeGraph({ projectId: 'p', now: NOW }),
      [{ id: 'empty-art', name: 'Artefacto vacío', type: 'markdown' }],
    );
    expect(report.issues.some((i) => i.type === 'low-graph-coverage')).toBe(true);
  });

  it('produces a verdict and severity counts and never throws', () => {
    const graph = buildArchitectureKnowledgeGraph(fullBuildInput);
    const report = analyzeArchitectureConsistency(graph, fullBuildInput.artifacts ?? []);
    expect(['clean', 'warning', 'blocked']).toContain(report.verdict);
    const total =
      report.countsBySeverity.critical +
      report.countsBySeverity.high +
      report.countsBySeverity.medium +
      report.countsBySeverity.low +
      report.countsBySeverity.info;
    expect(total).toBe(report.issues.length);
    for (const issue of report.issues) {
      expect(issue.recommendation.length).toBeGreaterThan(0);
      expect(typeof issue.autoFixable).toBe('boolean');
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  analyzeArchitectureTraceability,
  buildArchitectureKnowledgeGraph,
  getArtifactsSupportingEntity,
  getEntitiesInArtifact,
  getRisksWithoutMitigation,
} from '../../services/architectureKnowledgeGraph';
import { fullBuildInput } from './fixtures';

describe('ArchitectureTraceabilityService', () => {
  const graph = buildArchitectureKnowledgeGraph(fullBuildInput);

  it('detects requirements without test coverage', () => {
    const report = analyzeArchitectureTraceability(graph);
    expect(report.gaps.some((g) => g.type === 'requirement-without-test')).toBe(true);
  });

  it('computes requirement and risk coverage ratios in [0..1]', () => {
    const report = analyzeArchitectureTraceability(graph);
    expect(report.requirementCoverage).toBeGreaterThanOrEqual(0);
    expect(report.requirementCoverage).toBeLessThanOrEqual(1);
    expect(report.riskCoverage).toBeGreaterThanOrEqual(0);
    expect(report.riskCoverage).toBeLessThanOrEqual(1);
    expect(report.linkCount).toBeGreaterThan(0);
  });

  it('lists the entities an artifact contributed', () => {
    const entities = getEntitiesInArtifact(graph, 'art-c4');
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every((e) => e.sourceRefs.some((r) => r.artifactId === 'art-c4'))).toBe(true);
  });

  it('lists the artifacts that support an entity', () => {
    const requirement = graph.entities.find((e) => e.name === 'RF-001');
    expect(requirement).toBeDefined();
    const artifacts = getArtifactsSupportingEntity(graph, requirement!.id);
    expect(artifacts.length).toBeGreaterThan(0);
  });

  it('flags risks without a mitigation as traceability targets', () => {
    const risks = getRisksWithoutMitigation(graph);
    expect(risks.length).toBeGreaterThan(0);
  });
});

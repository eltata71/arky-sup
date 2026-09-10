import { describe, expect, it } from 'vitest';
import {
  analyzeArchitectureImpact,
  buildArchitectureGraphPromptContext,
  buildArchitectureKnowledgeGraph,
  buildArtifactGraphInsight,
  createEmptyArchitectureGraph,
} from '../../services/architectureKnowledgeGraph';
import { NOW, fullBuildInput } from './fixtures';

const graph = buildArchitectureKnowledgeGraph(fullBuildInput);

describe('ArchitectureImpactAnalysisService', () => {
  it('analyzes the impact of changing an entity', () => {
    const apiEntity = graph.entities.find((e) => e.name === 'API de Pagos');
    expect(apiEntity).toBeDefined();
    const result = analyzeArchitectureImpact(graph, { kind: 'entity', targetId: apiEntity!.id });
    expect(result.resolved).toBe(true);
    expect(result.relatedEntityIds.length).toBeGreaterThan(0);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(['info', 'low', 'medium', 'high', 'critical']).toContain(result.severity);
  });

  it('returns an unresolved result for an unknown target', () => {
    const result = analyzeArchitectureImpact(graph, { kind: 'entity', targetId: 'does-not-exist' });
    expect(result.resolved).toBe(false);
    expect(result.impactedArtifactIds).toHaveLength(0);
  });

  it('analyzes the impact of an artifact', () => {
    const result = analyzeArchitectureImpact(graph, { kind: 'artifact', targetId: 'art-c4' });
    expect(result.resolved).toBe(true);
  });
});

describe('ArchitectureGraphPromptContextBuilder', () => {
  it('builds a compact, budgeted prompt context', () => {
    const context = buildArchitectureGraphPromptContext(graph, {
      artifactType: 'mermaid-erd',
      maxChars: 1600,
      maxEntities: 10,
    });
    expect(context.empty).toBe(false);
    expect(context.markdown.length).toBeGreaterThan(0);
    expect(context.markdown.length).toBeLessThanOrEqual(1600);
    expect(context.includedEntityIds.length).toBeGreaterThan(0);
    expect(context.includedEntityIds.length).toBeLessThanOrEqual(10);
  });

  it('returns an empty context for an empty graph', () => {
    const context = buildArchitectureGraphPromptContext(createEmptyArchitectureGraph('p', NOW));
    expect(context.empty).toBe(true);
    expect(context.markdown).toBe('');
  });
});

describe('ArchitectureGraphQualityBridge', () => {
  it('builds a graph insight for an artifact that contributed entities', () => {
    const insight = buildArtifactGraphInsight(graph, 'art-c4');
    expect(insight.detectedEntityIds.length).toBeGreaterThan(0);
    expect(insight.coverageScore).toBeGreaterThanOrEqual(0);
    expect(insight.coverageScore).toBeLessThanOrEqual(100);
    expect(insight.recommendation.length).toBeGreaterThan(0);
  });

  it('warns when an artifact contributes nothing to the graph', () => {
    const insight = buildArtifactGraphInsight(graph, 'artifact-without-entities');
    expect(insight.detectedEntityIds).toHaveLength(0);
    expect(insight.coverageScore).toBe(0);
    expect(insight.shouldWarn).toBe(true);
  });
});

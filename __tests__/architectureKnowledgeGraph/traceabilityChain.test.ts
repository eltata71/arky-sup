import { describe, expect, it } from 'vitest';
import {
  analyzeTraceabilityChains,
  explainEntity,
  type ArchitectureGraph,
} from '../../services/architectureKnowledgeGraph';
import type {
  ArchitectureEntity,
  ArchitectureRelation,
} from '../../services/architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';

const entity = (id: string, type: ArchitectureEntity['type'], artifactId?: string): ArchitectureEntity =>
  ({
    id,
    projectId: 'p1',
    name: id,
    normalizedName: id,
    type,
    aliases: [],
    sourceRefs: artifactId ? [{ artifactId }] : [],
    confidence: 1,
    criticality: 'medium',
    status: 'active',
    tags: [],
    metadata: {},
  }) as unknown as ArchitectureEntity;

const relation = (id: string, type: ArchitectureRelation['type'], from: string, to: string): ArchitectureRelation =>
  ({ id, type, sourceEntityId: from, targetEntityId: to }) as unknown as ArchitectureRelation;

const graphOf = (entities: ArchitectureEntity[], relations: ArchitectureRelation[]): ArchitectureGraph =>
  ({ projectId: 'p1', entities, relations }) as unknown as ArchitectureGraph;

describe('analyzeTraceabilityChains', () => {
  it('reports a requirement with no decision and a decision with no artifact', () => {
    const graph = graphOf(
      [entity('rf', 'requirement'), entity('adr', 'decision', 'a1')],
      [],
    );
    const types = analyzeTraceabilityChains(graph).findings.map((f) => f.type).sort();
    expect(types).toEqual(['decision-without-artifact', 'requirement-without-decision']);
  });

  it('closes the chain requirement → decision → artifact-backed component', () => {
    const graph = graphOf(
      [entity('rf', 'requirement'), entity('adr', 'decision'), entity('svc', 'component', 'a1')],
      [relation('r1', 'tracesTo', 'rf', 'adr'), relation('r2', 'impacts', 'adr', 'svc')],
    );
    const report = analyzeTraceabilityChains(graph);
    expect(report.findings).toEqual([]);
    expect(report.chains[0].artifactIds).toEqual(['a1']);
  });

  it('reports broken relations and deleted artifacts instead of dropping them', () => {
    const graph = graphOf(
      [entity('svc', 'component', 'gone')],
      [relation('r1', 'impacts', 'svc', 'missing')],
    );
    const types = analyzeTraceabilityChains(graph, { knownArtifactIds: ['a1'] }).findings.map((f) => f.type);
    expect(types).toContain('broken-relation');
    expect(types).toContain('broken-artifact-reference');
  });
});

describe('explainEntity', () => {
  it('is unresolved for an unknown id', () => {
    expect(explainEntity(graphOf([], []), 'x').resolved).toBe(false);
  });

  it('separates what an entity answers to from what realises it', () => {
    const graph = graphOf(
      [entity('rf', 'requirement'), entity('adr', 'decision'), entity('svc', 'component', 'a1')],
      [relation('r1', 'tracesTo', 'rf', 'adr'), relation('r2', 'impacts', 'adr', 'svc')],
    );
    const explanation = explainEntity(graph, 'adr');
    expect(explanation.drivers.map((e) => e.id)).toEqual(['rf']);
    expect(explanation.realizations.map((e) => e.id)).toEqual(['svc']);
  });
});

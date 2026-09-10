import { describe, expect, it } from 'vitest';
import type { ArtifactTemplate, Project } from '../../types';
import type { ArchitectureEntity, ArchitectureGraph } from '../../services/architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';
import { buildDeterministicArtifactBrief } from '../../services/artifacts/artifactBriefService';
import { scoreArchitectureGraphAlignment } from '../../services/artifacts/architectureGraphAlignment';

const template: ArtifactTemplate = {
  name: 'Diagrama de integración de sistemas',
  type: 'mermaid-graph',
  phase: 'General',
  architecturalView: 'Vista Lógica y de Diseño',
  objective: 'Mostrar la integración entre el core y los sistemas externos.',
  keyConcepts: [],
  representation: 'diagram',
};

const makeEntity = (over: Partial<ArchitectureEntity>): ArchitectureEntity => ({
  id: 'ake-system-gateway',
  projectId: 'p1',
  name: 'Gateway de Integración',
  normalizedName: 'gateway de integracion',
  type: 'system',
  aliases: [],
  sourceRefs: [],
  confidence: 0.8,
  criticality: 'high',
  status: 'active',
  tags: [],
  metadata: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const makeGraph = (entities: ArchitectureEntity[]): ArchitectureGraph => ({
  projectId: 'p1',
  version: 1,
  buildId: 'build-1',
  lastBuiltAt: '2026-05-01T00:00:00.000Z',
  entities,
  relations: [],
  quality: {
    score: 80,
    averageConfidence: 0.8,
    artifactCoverage: 0.9,
    consistencyIssueCount: 0,
    traceabilityGapCount: 0,
    summary: 'Grafo saludable.',
  },
  statistics: {
    entityCount: entities.length,
    relationCount: 0,
    sourceArtifactCount: 1,
    byEntityType: {},
    byRelationType: {},
    lowConfidenceEntityCount: 0,
    candidateDuplicateCount: 0,
    orphanEntityCount: 0,
  },
});

const baseProject = (graph?: ArchitectureGraph): Project => ({
  id: 'p1',
  name: 'Core',
  description: 'Core con APIs y eventos de integración.',
  projectContext: [],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  architectureKnowledgeGraph: graph,
});

const contract = buildDeterministicArtifactBrief(
  baseProject(),
  'Diagrama de integración entre el core y los sistemas externos.',
  { now: '2026-05-18T00:00:00.000Z' },
);

describe('scoreArchitectureGraphAlignment', () => {
  it('#23 degrada a cero y no rompe cuando el proyecto no tiene grafo', () => {
    const result = scoreArchitectureGraphAlignment({ project: baseProject(), contract, template });
    expect(result.score).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('#24 aporta señales positivas cuando el grafo tiene entidades alineadas', () => {
    const project = baseProject(makeGraph([makeEntity({})]));
    const result = scoreArchitectureGraphAlignment({ project, contract, template });
    expect(result.score).toBeGreaterThan(0);
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('mantiene el score acotado en [0..14]', () => {
    const manyEntities = Array.from({ length: 30 }, (_, index) =>
      makeEntity({ id: `ake-system-${index}`, name: `Sistema de Integración ${index}` }));
    const project = baseProject(makeGraph(manyEntities));
    const result = scoreArchitectureGraphAlignment({ project, contract, template });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(14);
  });

  it('no rompe cuando el grafo existe pero está vacío', () => {
    const project = baseProject(makeGraph([]));
    const result = scoreArchitectureGraphAlignment({ project, contract, template });
    expect(result.score).toBe(0);
  });
});

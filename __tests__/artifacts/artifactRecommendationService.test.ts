import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import type { ArchitectureGraph } from '../../services/architectureKnowledgeGraph/ArchitectureKnowledgeGraphTypes';
import { buildDeterministicArtifactBrief, updateArtifactBriefFromForm } from '../../services/artifacts/domain/artifactBriefService';
import {
  buildArtifactRecommendationCandidates,
  totalRecommendationScore,
} from '../../services/artifacts/domain/artifactRecommendationService';

const NOW = '2026-05-18T00:00:00.000Z';

const makeArtifact = (over: Partial<Artifact>): Artifact => ({
  id: 'src-doc',
  versionGroupId: 'g-doc',
  version: 1,
  createdAt: '2026-05-10T00:00:00.000Z',
  name: 'Inventario de integraciones',
  type: 'markdown',
  phase: 'General',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'Inventario de APIs, eventos e integraciones del core bancario.',
  objective: 'Inventariar las integraciones del core.',
  keyConcepts: [],
  representation: 'document',
  ...over,
});

const makeProject = (artifacts: Artifact[] = [], graph?: ArchitectureGraph): Project => ({
  id: 'p1',
  name: 'Core bancario',
  description: 'Plataforma core con APIs e integraciones.',
  projectContext: ['El API Gateway concentra las integraciones.'],
  artifacts,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  architectureKnowledgeGraph: graph,
});

const graphFixture: ArchitectureGraph = {
  projectId: 'p1',
  version: 1,
  buildId: 'b1',
  lastBuiltAt: '2026-05-01T00:00:00.000Z',
  entities: [{
    id: 'ake-system-gateway',
    projectId: 'p1',
    name: 'Gateway de Integración',
    normalizedName: 'gateway de integracion',
    type: 'system',
    aliases: [],
    sourceRefs: [],
    confidence: 0.9,
    criticality: 'high',
    status: 'active',
    tags: [],
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }],
  relations: [],
  quality: { score: 82, averageConfidence: 0.9, artifactCoverage: 0.9, consistencyIssueCount: 0, traceabilityGapCount: 0, summary: 'ok' },
  statistics: { entityCount: 1, relationCount: 0, sourceArtifactCount: 1, byEntityType: {}, byRelationType: {}, lowConfidenceEntityCount: 0, candidateDuplicateCount: 0, orphanEntityCount: 0 },
};

describe('buildArtifactRecommendationCandidates', () => {
  it('#18 ordena el Top 3 por score descendente', () => {
    const project = makeProject();
    const contract = buildDeterministicArtifactBrief(project, 'Comunicar el estado general del proyecto al equipo.', { now: NOW });
    const candidates = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    expect(candidates.length).toBeGreaterThan(0);
    for (let i = 1; i < candidates.length; i += 1) {
      expect(totalRecommendationScore(candidates[i - 1].scoreBreakdown))
        .toBeGreaterThanOrEqual(totalRecommendationScore(candidates[i].scoreBreakdown));
    }
  });

  it('#19 una solicitud de documento no recomienda un diagrama como primera opción', () => {
    const project = makeProject();
    const contract = buildDeterministicArtifactBrief(project, 'Quiero un documento que resuma las decisiones de arquitectura.', { now: NOW });
    const candidates = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    expect(contract.artifactFamily).toBe('document');
    expect(candidates[0].template.representation).not.toBe('diagram');
  });

  it('#20 una solicitud de diagrama no recomienda un documento como primera opción', () => {
    const project = makeProject();
    const contract = buildDeterministicArtifactBrief(project, 'Quiero un diagrama de secuencia con las llamadas entre servicios.', { now: NOW });
    const candidates = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    expect(contract.artifactFamily).toBe('diagram');
    expect(candidates[0].template.representation).not.toBe('document');
  });

  it('#21 una solicitud de matriz prioriza artefactos documentales/tabulares', () => {
    const project = makeProject();
    const contract = buildDeterministicArtifactBrief(project, 'Necesito una matriz de trazabilidad de requerimientos contra pruebas.', { now: NOW });
    const candidates = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    expect(contract.artifactFamily).toBe('matrix');
    expect(candidates[0].template.representation).not.toBe('diagram');
  });

  it('#22 el score incorpora calidad y frescura de fuentes cuando hay datos', () => {
    const sourced = makeArtifact({ compilation: { compilerScore: 88 } as unknown as Artifact['compilation'] });
    const project = makeProject([sourced]);
    const base = buildDeterministicArtifactBrief(project, 'Documentar las integraciones del core bancario.', { now: NOW });
    const contract = updateArtifactBriefFromForm(base, { requiredSourceArtifactIds: ['src-doc'] });
    const candidates = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    const breakdown = candidates[0].scoreBreakdown;
    expect(breakdown.sourceQualityScore ?? 0).toBeGreaterThan(0);
    expect(breakdown.freshnessScore ?? 0).toBeGreaterThan(0);
    expect(typeof breakdown.phaseViewAlignment).toBe('number');
    expect(typeof breakdown.acceptanceCriteriaCoverage).toBe('number');
  });

  it('#23 un proyecto sin grafo arquitectónico no rompe el scoring', () => {
    const project = makeProject();
    const contract = buildDeterministicArtifactBrief(project, 'Documentar la integración del core.', { now: NOW });
    const candidates = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].scoreBreakdown.architectureGraphAlignment ?? 0).toBe(0);
  });

  it('#24 un grafo arquitectónico presente aporta señal sin bloquear', () => {
    const project = makeProject([], graphFixture);
    const contract = buildDeterministicArtifactBrief(project, 'Diagrama de integración del gateway con sistemas externos.', { now: NOW });
    const candidates = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    expect(candidates.length).toBeGreaterThan(0);
    expect((candidates[0].scoreBreakdown.architectureGraphAlignment ?? 0)).toBeGreaterThanOrEqual(0);
  });

  it('#25/#26 el candidato conserva el contrato y la selección de fuentes en requestContext', () => {
    const project = makeProject([makeArtifact({}), makeArtifact({ id: 'src-x', versionGroupId: 'g-x' })]);
    const base = buildDeterministicArtifactBrief(project, 'Documentar integraciones del core bancario.', { now: NOW });
    const contract = updateArtifactBriefFromForm(base, {
      requiredSourceArtifactIds: ['src-doc'],
      excludedSourceArtifactIds: ['src-x'],
    });
    const candidates = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    const requestContext = candidates[0].template.requestContext;
    expect(requestContext?.generationContract?.id).toBe(contract.id);
    expect(requestContext?.selectedSourceArtifactIds).toContain('src-doc');
    expect(requestContext?.excludedSourceArtifactIds).toEqual(contract.excludedSourceArtifactIds);
    expect(requestContext?.acceptanceCriteria).toEqual(contract.acceptanceCriteria);
  });


  it('los criterios de aceptación impactan el score de cobertura', () => {
    const project = makeProject();
    const base = buildDeterministicArtifactBrief(project, 'Necesito validar requerimientos y trazabilidad contra pruebas.', { now: NOW });
    const contract = updateArtifactBriefFromForm(base, {
      artifactFamily: 'matrix',
      acceptanceCriteria: ['Cubrir requerimientos, pruebas y trazabilidad.'],
    });
    const [top] = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    expect(top.scoreBreakdown.acceptanceCriteriaCoverage ?? 0).toBeGreaterThan(0);
  });

  it('genera riesgos cuando faltan fuentes solicitadas', () => {
    const project = makeProject();
    const base = buildDeterministicArtifactBrief(project, 'Documentar integraciones del core bancario con fuentes trazables.', { now: NOW });
    const contract = updateArtifactBriefFromForm(base, { requiredSourceArtifactIds: ['missing-source'] });
    const [top] = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    expect(top.risks.join(' ')).toContain('fuentes solicitadas no existen');
  });

  it('cada candidato contiene rationale, tradeoffs, plan, riesgos, salida esperada y scoreBreakdown', () => {
    const project = makeProject();
    const contract = buildDeterministicArtifactBrief(project, 'Preparar documento técnico de decisiones de integración.', { now: NOW });
    const candidates = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    candidates.forEach(candidate => {
      expect(candidate.rationale.length).toBeGreaterThan(0);
      expect(candidate.tradeoffs.length).toBeGreaterThan(0);
      expect(candidate.constructionPlan.length).toBeGreaterThan(0);
      expect(candidate.risks.length).toBeGreaterThan(0);
      expect(candidate.expectedOutput.length).toBeGreaterThan(0);
      expect(candidate.scoreBreakdown.intentMatch).toEqual(expect.any(Number));
    });
  });

  it('#31 cada candidato expone un ArtifactTemplate compatible con onGenerate', () => {
    const project = makeProject();
    const contract = buildDeterministicArtifactBrief(project, 'Documentar la arquitectura del core bancario.', { now: NOW });
    const candidates = buildArtifactRecommendationCandidates(project, contract, 3, { now: NOW });
    candidates.forEach(candidate => {
      expect(typeof candidate.template.name).toBe('string');
      expect(typeof candidate.template.type).toBe('string');
      expect(['diagram', 'document', 'hybrid']).toContain(candidate.template.representation);
      expect(candidate.tradeoffs.length).toBeGreaterThan(0);
      expect(candidate.risks.length).toBeGreaterThan(0);
    });
  });
});

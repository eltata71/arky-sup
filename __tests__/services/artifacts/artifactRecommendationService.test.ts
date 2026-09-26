import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../../lib/artifacts';
import type { Project } from '../../../services/architectureProjects';
import { buildDeterministicArtifactBrief } from '../../../services/artifacts/domain/artifactBriefService';
import { buildArtifactRecommendationCandidates, candidateToLegacyRecommendation } from '../../../services/artifacts/domain/artifactRecommendationService';

const baseProject: Project = {
  id: 'p1',
  name: 'Core Banking',
  description: 'Core bancario con APIs, datos maestros y canales digitales.',
  projectContext: ['API Gateway integra canales con core.', 'Modelo de datos de clientes y pólizas.'],
  artifacts: [{
    id: 'source-1',
    versionGroupId: 'source-1',
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    name: 'Inventario de APIs',
    type: 'markdown',
    phase: 'General',
    architecturalView: 'Vista Lógica y de Diseño',
    content: 'APIs, eventos, integración y dependencias del core.',
    objective: 'Inventariar APIs del core.',
    keyConcepts: [],
    representation: 'document',
  } satisfies Artifact],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('artifactRecommendationService', () => {
  it('ordena el Top 3 por score y adjunta fuentes/contrato a requestContext', () => {
    const contract = {
      ...buildDeterministicArtifactBrief(baseProject, 'Necesito un diagrama de integración API entre canales, core y eventos.', { now: '2026-05-18T00:00:00.000Z' }),
      requiredSourceArtifactIds: ['source-1'],
    };
    const candidates = buildArtifactRecommendationCandidates(baseProject, contract, 3);
    const scores = candidates.map(candidate => Object.values(candidate.scoreBreakdown).reduce((sum, value, index) => index === 5 ? sum - value : sum + value, 0));

    expect(candidates).toHaveLength(3);
    expect(scores[0]).toBeGreaterThanOrEqual(scores[1]);
    expect(candidates[0].template.requestContext?.generationContract?.id).toBe(contract.id);
    expect(candidates[0].template.requestContext?.selectedSourceArtifactIds).toContain('source-1');
  });

  it('prioriza documento cuando la solicitud lo pide explícitamente', () => {
    const contract = buildDeterministicArtifactBrief(baseProject, 'Necesito un documento ejecutivo para explicar riesgos y decisión de modernización.', { now: '2026-05-18T00:00:00.000Z' });
    const [top] = buildArtifactRecommendationCandidates(baseProject, contract, 3);
    expect(top.template.representation).not.toBe('diagram');
  });

  it('prioriza diagrama cuando la solicitud visual lo pide explícitamente', () => {
    const contract = buildDeterministicArtifactBrief(baseProject, 'Necesito un diagrama visual de integración API y eventos del core.', { now: '2026-05-18T00:00:00.000Z' });
    const [top] = buildArtifactRecommendationCandidates(baseProject, contract, 3);
    expect(['diagram', 'hybrid']).toContain(top.template.representation);
  });

  it('prioriza artefactos documentales/tabulares para solicitudes de matriz o tabla', () => {
    const contract = buildDeterministicArtifactBrief(baseProject, 'Necesito una matriz de trazabilidad de requisitos, componentes y riesgos.', { now: '2026-05-18T00:00:00.000Z' });
    const [top] = buildArtifactRecommendationCandidates(baseProject, contract, 3);
    expect(top.template.representation).toBe('document');
  });

  it('convierte el candidato seleccionado en ArtifactTemplate compatible', () => {
    const contract = buildDeterministicArtifactBrief(baseProject, 'Necesito documentar decisiones de arquitectura para revisión técnica.', { now: '2026-05-18T00:00:00.000Z' });
    const [candidate] = buildArtifactRecommendationCandidates(baseProject, contract, 1);
    const recommendation = candidateToLegacyRecommendation(candidate);

    expect(recommendation.template.requestContext?.userRequest).toBe(contract.originalRequest);
    expect(recommendation.template.requestContext?.acceptanceCriteria).toEqual(contract.acceptanceCriteria);
    expect(recommendation.template.name.length).toBeGreaterThan(0);
  });
});

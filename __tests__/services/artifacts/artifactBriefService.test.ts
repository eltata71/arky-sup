import { describe, expect, it } from 'vitest';
import type { Project } from '../../../services/architectureProjects';
import { buildDeterministicArtifactBrief, updateArtifactBriefFromForm } from '../../../services/artifacts/domain/artifactBriefService';
import { __test__parseArtifactGenerationFlag } from '../../../services/artifacts/domain/artifactGenerationFlags';

const project: Project = {
  id: 'p1',
  name: 'Modernización Core',
  description: 'Modernización de core bancario con APIs, eventos y reducción de riesgo operativo.',
  projectContext: ['Canales digitales consumen API Gateway.', 'Riesgo regulatorio por trazabilidad de decisiones.'],
  artifacts: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('artifactBriefService', () => {
  it('transforma texto libre en un ArtifactGenerationContract válido por heurísticas determinísticas', () => {
    const contract = buildDeterministicArtifactBrief(
      project,
      'Necesito un documento ejecutivo para decidir la modernización del core y explicar riesgos, beneficios y decisión esperada al comité gerencial.',
      { now: '2026-05-18T00:00:00.000Z', language: 'es' },
    );

    expect(contract.id).toMatch(/^agc-/);
    expect(contract.originalRequest).toContain('documento ejecutivo');
    expect(contract.normalizedIntent).toContain('modernización del core');
    expect(contract.audience).toBe('executive');
    expect(contract.artifactFamily).toBe('document');
    expect(contract.purpose).toBe('decision');
    expect(contract.detailLevel).toBe('executive');
    expect(contract.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
    expect(contract.requiredContextItems).toHaveLength(2);
  });

  it('permite editar audiencia, propósito, familia y nivel de detalle sin perder el resto del contrato', () => {
    const contract = buildDeterministicArtifactBrief(project, 'Necesito diagramar integraciones API y eventos para el equipo técnico.', { now: '2026-05-18T00:00:00.000Z' });
    const edited = updateArtifactBriefFromForm(contract, {
      audience: 'business',
      purpose: 'communication',
      artifactFamily: 'presentation',
      detailLevel: 'conceptual',
    });

    expect(edited.audience).toBe('business');
    expect(edited.purpose).toBe('communication');
    expect(edited.artifactFamily).toBe('presentation');
    expect(edited.detailLevel).toBe('conceptual');
    expect(edited.originalRequest).toBe(contract.originalRequest);
  });

  it('parsea feature flags apagados para conservar el flujo anterior', () => {
    expect(__test__parseArtifactGenerationFlag('false', true)).toBe(false);
    expect(__test__parseArtifactGenerationFlag('0', true)).toBe(false);
    expect(__test__parseArtifactGenerationFlag(undefined, true)).toBe(true);
  });
});

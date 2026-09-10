import { describe, expect, it } from 'vitest';
import type { Artifact, Project } from '../../types';
import {
  mergeArtifactGenerationContracts,
  normalizeArtifactGenerationContract,
  validateArtifactGenerationContract,
  type ArtifactGenerationContract,
} from '../../services/artifacts/artifactGenerationContract';

const makeArtifact = (over: Partial<Artifact>): Artifact => ({
  id: 'a1',
  versionGroupId: 'g1',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'Inventario de APIs',
  type: 'markdown',
  phase: 'General',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'APIs y eventos del core.',
  objective: 'Inventariar APIs.',
  keyConcepts: [],
  representation: 'document',
  ...over,
});

const project: Project = {
  id: 'p1',
  name: 'Core',
  description: 'Core con APIs.',
  projectContext: [],
  artifacts: [makeArtifact({ id: 'src-1' }), makeArtifact({ id: 'src-2', versionGroupId: 'g2' })],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const baseContract = (over: Partial<ArtifactGenerationContract> = {}): ArtifactGenerationContract =>
  normalizeArtifactGenerationContract({
    id: 'agc-test',
    originalRequest: 'Documentar la arquitectura de integración del core bancario.',
    normalizedIntent: 'Documentar la arquitectura de integración del core bancario.',
    audience: 'mixed',
    artifactFamily: 'document',
    purpose: 'design',
    detailLevel: 'logical',
    requiredSourceArtifactIds: [],
    optionalSourceArtifactIds: [],
    excludedSourceArtifactIds: [],
    requiredContextItems: [],
    excludedContextItems: [],
    acceptanceCriteria: ['Responder a la intención.', 'Mantener trazabilidad.'],
    exportTargets: ['markdown', 'pdf'],
    language: 'es',
    qualityTarget: 90,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...over,
  });

describe('artifactGenerationContract — validation & normalization', () => {
  it('#7 validateArtifactGenerationContract detecta un contrato inválido', () => {
    const invalid = baseContract({
      id: '',
      originalRequest: 'corto',
      acceptanceCriteria: [],
      qualityTarget: 40,
    });
    const errors = validateArtifactGenerationContract(invalid);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('#8 normalizeArtifactGenerationContract deduplica fuentes y respeta exclusiones', () => {
    const normalized = normalizeArtifactGenerationContract(baseContract({
      requiredSourceArtifactIds: ['src-1', 'src-1', 'src-2'],
      optionalSourceArtifactIds: ['src-2', 'src-3'],
      excludedSourceArtifactIds: ['src-2'],
    }));
    expect(normalized.requiredSourceArtifactIds).toEqual(['src-1']);
    expect(normalized.optionalSourceArtifactIds).toEqual(['src-3']);
    expect(normalized.excludedSourceArtifactIds).toContain('src-2');
    expect(normalized.requiredSourceArtifactIds).not.toContain('src-2');
    expect(normalized.optionalSourceArtifactIds).not.toContain('src-2');
  });
});

describe('mergeArtifactGenerationContracts', () => {
  it('#10 fusiona campos IA válidos y los marca como aceptados', () => {
    const deterministic = baseContract();
    const result = mergeArtifactGenerationContracts({
      deterministic,
      aiCandidate: {
        audience: 'executive',
        acceptanceCriteria: ['Criterio adicional propuesto por IA.'],
      },
      project,
    });
    expect(result.contract.audience).toBe('executive');
    expect(result.acceptedAiFields).toContain('audience');
    expect(result.contract.acceptanceCriteria).toEqual(expect.arrayContaining(deterministic.acceptanceCriteria));
    expect(result.contract.acceptanceCriteria).toContain('Criterio adicional propuesto por IA.');
  });

  it('rechaza valores de enum inválidos sin romper el contrato', () => {
    const result = mergeArtifactGenerationContracts({
      deterministic: baseContract(),
      aiCandidate: { audience: 'not-a-real-audience' as ArtifactGenerationContract['audience'] },
      project,
    });
    expect(result.contract.audience).toBe('mixed');
    expect(result.rejectedAiFields).toContain('audience');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('#12 la IA no puede eliminar ni reactivar fuentes excluidas', () => {
    const deterministic = baseContract({ excludedSourceArtifactIds: ['src-1'] });
    const result = mergeArtifactGenerationContracts({
      deterministic,
      aiCandidate: { requiredSourceArtifactIds: ['src-1'], optionalSourceArtifactIds: ['src-1'] },
      project,
    });
    expect(result.contract.excludedSourceArtifactIds).toContain('src-1');
    expect(result.contract.requiredSourceArtifactIds).not.toContain('src-1');
    expect(result.contract.optionalSourceArtifactIds).not.toContain('src-1');
  });

  it('la IA no puede inventar fuentes inexistentes', () => {
    const result = mergeArtifactGenerationContracts({
      deterministic: baseContract(),
      aiCandidate: { requiredSourceArtifactIds: ['ghost-artifact'] },
      project,
    });
    expect(result.contract.requiredSourceArtifactIds).not.toContain('ghost-artifact');
    expect(result.rejectedAiFields).toContain('sourceArtifactIds');
  });

  it('#13 la IA no puede bajar el qualityTarget por debajo del determinístico', () => {
    const result = mergeArtifactGenerationContracts({
      deterministic: baseContract({ qualityTarget: 90 }),
      aiCandidate: { qualityTarget: 60 },
      project,
    });
    expect(result.contract.qualityTarget).toBe(90);
    expect(result.rejectedAiFields).toContain('qualityTarget');
  });

  it('la IA puede subir el qualityTarget', () => {
    const result = mergeArtifactGenerationContracts({
      deterministic: baseContract({ qualityTarget: 90 }),
      aiCandidate: { qualityTarget: 95 },
      project,
    });
    expect(result.contract.qualityTarget).toBe(95);
    expect(result.acceptedAiFields).toContain('qualityTarget');
  });

  it('nunca reemplaza la solicitud original y rechaza una intención que la pierde', () => {
    const deterministic = baseContract();
    const result = mergeArtifactGenerationContracts({
      deterministic,
      aiCandidate: { normalizedIntent: 'Algo completamente distinto sin relación alguna.' },
      project,
    });
    expect(result.contract.originalRequest).toBe(deterministic.originalRequest);
    expect(result.rejectedAiFields).toContain('normalizedIntent');
  });

  it('las ediciones del usuario prevalecen sobre la propuesta IA', () => {
    const result = mergeArtifactGenerationContracts({
      deterministic: baseContract(),
      aiCandidate: { audience: 'executive' },
      existingUserEdits: { audience: 'technical' },
      project,
    });
    expect(result.contract.audience).toBe('technical');
  });
});

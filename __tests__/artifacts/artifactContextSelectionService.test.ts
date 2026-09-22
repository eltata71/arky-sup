import { describe, expect, it } from 'vitest';
import type { Artifact } from '../../lib/artifacts';
import type { Project } from '../../services/architectureProjects';
import {
  normalizeArtifactGenerationContract,
  type ArtifactGenerationContract,
} from '../../services/artifacts/artifactGenerationContract';
import {
  selectArtifactGenerationContext,
  validateControlledContextForPrompt,
} from '../../services/artifacts/artifactContextSelectionService';

const makeArtifact = (over: Partial<Artifact>): Artifact => ({
  id: 'a',
  versionGroupId: 'g',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  name: 'Artefacto',
  type: 'markdown',
  phase: 'General',
  architecturalView: 'Vista Lógica y de Diseño',
  content: 'Contenido del artefacto sobre APIs y eventos del core.',
  objective: 'Objetivo del artefacto.',
  keyConcepts: [],
  representation: 'document',
  ...over,
});

const project: Project = {
  id: 'p1',
  name: 'Core',
  description: 'Core con APIs y eventos.',
  projectContext: ['El API Gateway es el punto de entrada.'],
  artifacts: [
    makeArtifact({ id: 'a-v1', versionGroupId: 'grp-a', version: 1, name: 'Inventario APIs', createdAt: '2026-01-01T00:00:00.000Z' }),
    makeArtifact({ id: 'a-v2', versionGroupId: 'grp-a', version: 2, name: 'Inventario APIs', createdAt: '2026-03-01T00:00:00.000Z' }),
    makeArtifact({ id: 'b-1', versionGroupId: 'grp-b', version: 1, name: 'Modelo de datos' }),
    makeArtifact({ id: 'c-1', versionGroupId: 'grp-c', version: 1, name: 'Diagrama de despliegue' }),
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const makeContract = (over: Partial<ArtifactGenerationContract> = {}): ArtifactGenerationContract =>
  normalizeArtifactGenerationContract({
    id: 'agc-test',
    originalRequest: 'Documentar la arquitectura de integración del core bancario.',
    normalizedIntent: 'Documentar la arquitectura de integración del core bancario.',
    audience: 'technical',
    artifactFamily: 'document',
    purpose: 'design',
    detailLevel: 'logical',
    requiredSourceArtifactIds: [],
    optionalSourceArtifactIds: [],
    excludedSourceArtifactIds: [],
    requiredContextItems: [],
    excludedContextItems: [],
    acceptanceCriteria: ['Responder a la intención.'],
    exportTargets: ['markdown'],
    language: 'es',
    qualityTarget: 90,
    createdAt: '2026-05-18T00:00:00.000Z',
    updatedAt: '2026-05-18T00:00:00.000Z',
    ...over,
  });

describe('selectArtifactGenerationContext — controlled sources', () => {
  it('#14 una fuente obligatoria de versión antigua se mapea a la más reciente del grupo', () => {
    const selection = selectArtifactGenerationContext(project, makeContract({ requiredSourceArtifactIds: ['a-v1'] }));
    expect(selection.requiredSources.map(source => source.id)).toEqual(['a-v2']);
    const mapping = selection.resolvedSourceMappings.find(item => item.requestedId === 'a-v1');
    expect(mapping?.resolution).toBe('latest-version');
    expect(mapping?.resolvedId).toBe('a-v2');
    expect(mapping?.warning).toBeTruthy();
  });

  it('preserva la versión exacta cuando el contrato lo exige', () => {
    const selection = selectArtifactGenerationContext(
      project,
      makeContract({ requiredSourceArtifactIds: ['a-v1'] }),
      { preserveExactSourceVersions: true },
    );
    expect(selection.requiredSources.map(source => source.id)).toEqual(['a-v1']);
    expect(selection.resolvedSourceMappings[0]?.resolution).toBe('exact');
  });

  it('#15 una fuente excluida nunca aparece como usada', () => {
    const selection = selectArtifactGenerationContext(project, makeContract({
      requiredSourceArtifactIds: ['a-v2'],
      excludedSourceArtifactIds: ['b-1'],
    }));
    const usedIds = [...selection.requiredSources, ...selection.optionalSources].map(source => source.id);
    expect(usedIds).not.toContain('b-1');
    expect(selection.excludedSources.map(source => source.id)).toContain('b-1');
    expect(validateControlledContextForPrompt(selection).ok).toBe(true);
  });

  it('#16 un conflicto requerido/excluido del mismo grupo se resuelve a favor de la exclusión', () => {
    // a-v2 is required but a-v1 (same version group grp-a) is excluded.
    const selection = selectArtifactGenerationContext(project, makeContract({
      requiredSourceArtifactIds: ['a-v2'],
      excludedSourceArtifactIds: ['a-v1'],
    }));
    expect(selection.requiredSources.map(source => source.id)).not.toContain('a-v2');
    const mapping = selection.resolvedSourceMappings.find(item => item.requestedId === 'a-v2');
    expect(mapping?.resolution).toBe('excluded-conflict');
  });

  it('#17 respeta el presupuesto de fuentes opcionales', () => {
    const selection = selectArtifactGenerationContext(
      project,
      makeContract({ optionalSourceArtifactIds: ['a-v2', 'b-1', 'c-1'] }),
      { maxOptionalSources: 1 },
    );
    expect(selection.optionalSources.length).toBe(1);
  });

  it('registra advertencia sin fallar cuando una fuente obligatoria no existe', () => {
    const selection = selectArtifactGenerationContext(project, makeContract({ requiredSourceArtifactIds: ['ghost'] }));
    expect(selection.requiredSources).toEqual([]);
    const mapping = selection.resolvedSourceMappings.find(item => item.requestedId === 'ghost');
    expect(mapping?.resolution).toBe('missing');
    expect(mapping?.warning).toBeTruthy();
  });

  it('#27 el promptBlock no presenta fuentes excluidas como evidencia usable', () => {
    const selection = selectArtifactGenerationContext(project, makeContract({
      requiredSourceArtifactIds: ['a-v2'],
      excludedSourceArtifactIds: ['b-1'],
    }));
    const usedSection = selection.promptBlock.split('Fuentes excluidas')[0];
    expect(usedSection).not.toContain('[b-1]');
    expect(selection.promptBlock).toContain('prohibido usar las fuentes excluidas');
  });
});

describe('validateControlledContextForPrompt', () => {
  it('detecta una fuente excluida que también aparece como usada', () => {
    const selection = selectArtifactGenerationContext(project, makeContract({ requiredSourceArtifactIds: ['a-v2'] }));
    const tampered = {
      ...selection,
      excludedSources: [...selection.requiredSources],
    };
    const result = validateControlledContextForPrompt(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('una selección limpia se valida sin errores', () => {
    const selection = selectArtifactGenerationContext(project, makeContract({ requiredSourceArtifactIds: ['a-v2'] }));
    expect(validateControlledContextForPrompt(selection).ok).toBe(true);
  });
});
